import * as vscode from 'vscode';
import { LuaRocksManager } from "./LuaRocksManager";
import { LuaRocksTreeProvider, PackageTreeItem } from './LuaRocksTreeProvider';
import { extensionContext } from '../extension';


let luaRocksManager: LuaRocksManager | undefined;
let luaRocksTreeProvider: LuaRocksTreeProvider | undefined;

export async function initializeLuaRocks(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return;
    }

    const rockspecFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(workspaceFolder, '*.rockspec'),
        null,
        10
    );

    if (rockspecFiles.length === 0) {
        return;
    }

    luaRocksManager = new LuaRocksManager(workspaceFolder);
    luaRocksTreeProvider = new LuaRocksTreeProvider(luaRocksManager);

    const treeView = vscode.window.createTreeView('emmylua.luarocks', {
        treeDataProvider: luaRocksTreeProvider,
        showCollapseAll: true
    });

    extensionContext.vscodeContext.subscriptions.push(
        treeView,
        luaRocksManager,
        luaRocksTreeProvider
    );

    const isInstalled = await luaRocksManager.checkLuaRocksInstallation();
    if (isInstalled) {
        let workspace = await luaRocksManager.detectLuaRocksWorkspace();
        if (workspace) {
            // 只有在第一次打开工作区时才显示提示
            const hasShownMessage = extensionContext.vscodeContext.workspaceState.get('luarocks.rockspecMessageShown', false);
            if (!hasShownMessage) {
                vscode.window.showInformationMessage(
                    vscode.l10n.t('Found {0} rockspec file(s) in workspace', workspace.rockspecFiles.length)
                );
                await extensionContext.vscodeContext.workspaceState.update('luarocks.rockspecMessageShown', true);
            }
        }
    }
}

export async function searchPackages(): Promise<void> {
    if (!luaRocksManager || !luaRocksTreeProvider) {
        vscode.window.showErrorMessage(vscode.l10n.t('LuaRocks not initialized'));
        return;
    }

    const query = await vscode.window.showInputBox({
        prompt: vscode.l10n.t('Enter package name or search term'),
        placeHolder: vscode.l10n.t('e.g., lpeg, luasocket, etc.')
    });

    if (!query) {
        return;
    }

    try {
        const packages = await luaRocksManager.searchPackages(query);
        if (packages.length === 0) {
            vscode.window.showInformationMessage(vscode.l10n.t('No packages found for "{0}"', query));
        } else {
            luaRocksTreeProvider.setSearchResults(packages);
            vscode.window.showInformationMessage(vscode.l10n.t('Found {0} package(s) for "{1}"', packages.length, query));
        }
    } catch (error) {
        vscode.window.showErrorMessage(vscode.l10n.t('Search failed: {0}', String(error)));
    }
}

export async function installPackage(item?: PackageTreeItem): Promise<void> {
    if (!luaRocksManager || !luaRocksTreeProvider) {
        vscode.window.showErrorMessage(vscode.l10n.t('LuaRocks not initialized'));
        return;
    }

    let packageName: string;
    let packageVersion: string | undefined;

    if (item && item.packageInfo) {
        packageName = item.packageInfo.name;
        packageVersion = item.packageInfo.version;
    } else {
        const input = await vscode.window.showInputBox({
            prompt: vscode.l10n.t('Enter package name (optionally with version)'),
            placeHolder: vscode.l10n.t('e.g., lpeg or lpeg 1.0.2')
        });

        if (!input) {
            return;
        }

        const parts = input.trim().split(/\s+/);
        packageName = parts[0];
        packageVersion = parts[1];
    }

    const success = await luaRocksManager.installPackage(packageName, packageVersion);
    if (success) {
        luaRocksTreeProvider.refreshInstalled();
    }
}

export async function uninstallPackage(item: PackageTreeItem): Promise<void> {
    if (!luaRocksManager || !luaRocksTreeProvider) {
        vscode.window.showErrorMessage(vscode.l10n.t('LuaRocks not initialized'));
        return;
    }

    if (!item.packageInfo) {
        vscode.window.showErrorMessage(vscode.l10n.t('No package selected'));
        return;
    }

    const packageName = item.packageInfo.name;
    const confirm = await vscode.window.showWarningMessage(
        vscode.l10n.t('Are you sure you want to uninstall "{0}"?', packageName),
        vscode.l10n.t('Yes'),
        vscode.l10n.t('No')
    );

    if (confirm === vscode.l10n.t('Yes')) {
        const success = await luaRocksManager.uninstallPackage(packageName);
        if (success) {
            luaRocksTreeProvider.refreshInstalled();
        }
    }
}

interface PackageInfoItem extends vscode.QuickPickItem {
    readonly action?: 'homepage' | 'uninstall' | 'install';
}

export async function showPackageInfo(item: PackageTreeItem): Promise<void> {
    if (!luaRocksManager) {
        vscode.window.showErrorMessage(vscode.l10n.t('LuaRocks not initialized'));
        return;
    }

    if (!item.packageInfo) {
        vscode.window.showErrorMessage(vscode.l10n.t('No package selected'));
        return;
    }

    const packageInfo = await luaRocksManager.getPackageInfo(item.packageInfo.name);
    if (!packageInfo) {
        vscode.window.showErrorMessage(vscode.l10n.t('Failed to get package information'));
        return;
    }

    // 使用QuickPick显示包信息，这样不会影响树视图
    const quickPick = vscode.window.createQuickPick<PackageInfoItem>();
    quickPick.title = vscode.l10n.t('Package: {0}', packageInfo.name);
    quickPick.placeholder = vscode.l10n.t('Package Information');

    const items: PackageInfoItem[] = [
        {
            label: `$(package) ${packageInfo.name}`,
            description: vscode.l10n.t('Version: {0}', packageInfo.version || vscode.l10n.t('Unknown')),
            detail: packageInfo.description || packageInfo.summary || vscode.l10n.t('No description available')
        }
    ];

    if (packageInfo.author) {
        items.push({
            label: `$(person) ${vscode.l10n.t('Author')}`,
            description: packageInfo.author
        });
    }

    if (packageInfo.license) {
        items.push({
            label: `$(law) ${vscode.l10n.t('License')}`,
            description: packageInfo.license
        });
    }

    if (packageInfo.homepage) {
        items.push({
            action: 'homepage',
            label: `$(link-external) ${vscode.l10n.t('Homepage')}`,
            description: packageInfo.homepage,
            detail: vscode.l10n.t('Click to open in browser')
        });
    }

    if (packageInfo.location && packageInfo.installed) {
        items.push({
            label: `$(folder) ${vscode.l10n.t('Location')}`,
            description: packageInfo.location
        });
    }

    items.push({
        label: `$(info) ${vscode.l10n.t('Status')}`,
        description: packageInfo.installed ? vscode.l10n.t('Installed') : vscode.l10n.t('Available for installation')
    });

    // 添加操作按钮
    if (packageInfo.installed) {
        items.push({
            action: 'uninstall',
            label: `$(trash) ${vscode.l10n.t('Uninstall Package')}`,
            description: vscode.l10n.t('Remove this package'),
            detail: vscode.l10n.t('Click to uninstall')
        });
    } else {
        items.push({
            action: 'install',
            label: `$(cloud-download) ${vscode.l10n.t('Install Package')}`,
            description: vscode.l10n.t('Install this package'),
            detail: vscode.l10n.t('Click to install')
        });
    }

    quickPick.items = items;

    quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0];
        if (selected) {
            switch (selected.action) {
                case 'homepage':
                    if (packageInfo.homepage) {
                        vscode.env.openExternal(vscode.Uri.parse(packageInfo.homepage));
                    }
                    break;
                case 'uninstall':
                    quickPick.hide();
                    uninstallPackage(item);
                    break;
                case 'install':
                    quickPick.hide();
                    installPackage(item);
                    break;
            }
        }
    });

    quickPick.show();
}

export async function refreshPackages(): Promise<void> {
    if (!luaRocksTreeProvider) {
        vscode.window.showErrorMessage(vscode.l10n.t('LuaRocks not initialized'));
        return;
    }

    await luaRocksTreeProvider.refreshInstalled();
    vscode.window.showInformationMessage(vscode.l10n.t('Package list refreshed'));
}

export async function showPackagesView(): Promise<void> {
    await vscode.commands.executeCommand('emmylua.luarocks.focus');
}

export function clearSearch(): void {
    if (!luaRocksTreeProvider) {
        vscode.window.showErrorMessage(vscode.l10n.t('LuaRocks not initialized'));
        return;
    }

    luaRocksTreeProvider.clearSearch();
}

export async function checkLuaRocksInstallation(): Promise<void> {
    if (!luaRocksManager) {
        vscode.window.showErrorMessage(vscode.l10n.t('LuaRocks not initialized'));
        return;
    }

    const isInstalled = await luaRocksManager.checkLuaRocksInstallation();
    if (isInstalled) {
        vscode.window.showInformationMessage(vscode.l10n.t('LuaRocks is installed and ready to use'));
    } else {
        const action = await vscode.window.showWarningMessage(
            vscode.l10n.t('LuaRocks is not installed or not in PATH'),
            vscode.l10n.t('Install Guide'),
            vscode.l10n.t('Dismiss')
        );
        if (action === vscode.l10n.t('Install Guide')) {
            vscode.env.openExternal(vscode.Uri.parse('https://luarocks.org/#quick-start'));
        }
    }
}
