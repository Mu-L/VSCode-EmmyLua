import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';

/**
 * Server health status
 */
export enum ServerState {
    /** Server is starting up */
    Starting = 'starting',
    /** Server is running normally */
    Running = 'running',
    /** Server is stopping */
    Stopping = 'stopping',
    /** Server is stopped */
    Stopped = 'stopped',
    /** Server encountered a warning */
    Warning = 'warning',
    /** Server encountered an error */
    Error = 'error',
}

/**
 * Server status information
 */
export interface ServerStatus {
    /** Current server state */
    state: ServerState;
    /** Optional status message */
    message?: string;
    /** Additional details for tooltip */
    details?: string;
}

/**
 * Status bar configuration
 */
interface StatusBarConfig {
    readonly icon: string;
    readonly color?: vscode.ThemeColor;
    readonly backgroundColor?: vscode.ThemeColor;
}

interface TooltipAction {
    readonly label: string;
    readonly command: string;
    readonly icon: string;
    readonly tooltip?: string;
}

interface ServerMenuItem extends vscode.QuickPickItem {
    readonly action: 'restart' | 'stop' | 'start' | 'info' | 'diagnostics' | 'output' | 'syntaxTree';
}

/**
 * EmmyLua extension context manager
 * Manages language client, status bar, and extension state
 */
export class EmmyContext implements vscode.Disposable {
    public readonly LANGUAGE_ID = 'lua' as const;

    private _client?: LanguageClient;
    private _serverStatus: ServerStatus;
    private readonly _statusBar: vscode.StatusBarItem;
    private readonly _languageStatus: vscode.LanguageStatusItem;
    private readonly _disposables: vscode.Disposable[] = [];

    constructor(
        public readonly debugMode: boolean,
        public readonly vscodeContext: vscode.ExtensionContext,
    ) {
        this._serverStatus = { state: ServerState.Stopped };
        this._statusBar = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this._languageStatus = vscode.languages.createLanguageStatusItem(
            'emmylua.serverStatus',
            { language: this.LANGUAGE_ID }
        );

        // Status bar click shows quick pick menu instead of direct action
        this._statusBar.command = 'emmy.showServerMenu';
        this._languageStatus.name = 'EmmyLua';
        this._languageStatus.command = {
            command: 'emmy.showServerMenu',
            title: 'EmmyLua: Server Control'
        };

        this._disposables.push(this._statusBar, this._languageStatus);
        this.updateStatusBar();
    }

    // ==================== Public API ====================

    /**
     * Get the language client instance
     */
    get client(): LanguageClient | undefined {
        return this._client;
    }

    /**
     * Set the language client instance
     */
    set client(value: LanguageClient | undefined) {
        this._client = value;
    }

    /**
     * Get current server status
     */
    get serverStatus(): Readonly<ServerStatus> {
        return this._serverStatus;
    }

    /**
     * Check if server is running
     */
    get isServerRunning(): boolean {
        return this._serverStatus.state === ServerState.Running;
    }

    /**
     * Check if server is starting
     */
    get isServerStarting(): boolean {
        return this._serverStatus.state === ServerState.Starting;
    }

    /**
     * Update server status to starting
     */
    setServerStarting(message?: string): void {
        this._serverStatus = {
            state: ServerState.Starting,
            message: message || vscode.l10n.t('Starting EmmyLua language server...'),
        };
        this.updateStatusBar();
    }

    /**
     * Update server status to running
     */
    setServerRunning(message?: string): void {
        this._serverStatus = {
            state: ServerState.Running,
            message: message || vscode.l10n.t('EmmyLua language server is running'),
        };
        this.updateStatusBar();
    }

    /**
     * Update server status to stopping
     */
    setServerStopping(message?: string): void {
        this._serverStatus = {
            state: ServerState.Stopping,
            message: message || vscode.l10n.t('Stopping EmmyLua language server...'),
        };
        this.updateStatusBar();
    }

    /**
     * Update server status to stopped
     */
    setServerStopped(message?: string): void {
        this._serverStatus = {
            state: ServerState.Stopped,
            message: message || vscode.l10n.t('EmmyLua language server is stopped'),
        };
        this.updateStatusBar();
    }

    /**
     * Update server status to warning
     */
    setServerWarning(message: string, details?: string): void {
        this._serverStatus = {
            state: ServerState.Warning,
            message,
            details,
        };
        this.updateStatusBar();
    }

    /**
     * Update server status to error
     */
    setServerError(message: string, details?: string): void {
        this._serverStatus = {
            state: ServerState.Error,
            message,
            details,
        };
        this.updateStatusBar();
    }

    /**
     * Stop the language server
     */
    async stopServer(): Promise<void> {
        if (!this._client) {
            return;
        }

        this.setServerStopping();
        try {
            await this._client.stop();
            this.setServerStopped();
        } catch (error) {
            this.setServerError('Failed to stop server', String(error));
        }
    }

    /**
     * Show server control menu
     */
    async showServerMenu(): Promise<void> {
        const items: ServerMenuItem[] = [];

        // Build menu based on current state
        if (this.isServerRunning) {
            items.push(
                {
                    action: 'restart',
                    label: '$(debug-restart) ' + vscode.l10n.t('Restart Server'),
                    description: vscode.l10n.t('Restart the language server'),
                    detail: vscode.l10n.t('Stop and restart the EmmyLua language server'),
                },
                {
                    action: 'stop',
                    label: '$(stop-circle) ' + vscode.l10n.t('Stop Server'),
                    description: vscode.l10n.t('Stop the language server'),
                    detail: vscode.l10n.t('Gracefully stop the EmmyLua language server'),
                }
            );
        } else {
            items.push({
                action: 'start',
                label: '$(play) ' + vscode.l10n.t('Start Server'),
                description: vscode.l10n.t('Start the language server'),
                detail: vscode.l10n.t('Start the EmmyLua language server'),
            });
        }

        items.push(
            {
                action: 'info',
                label: '$(info) ' + vscode.l10n.t('Show Server Info'),
                description: vscode.l10n.t('Display server information'),
                detail: vscode.l10n.t('Show detailed server status and configuration'),
            },
            {
                action: 'diagnostics',
                label: '$(heart-pulse) ' + vscode.l10n.t('Open Diagnostics'),
                description: vscode.l10n.t('Open a diagnostics report'),
                detail: vscode.l10n.t('Show runtime status, configuration scope, and server executable details'),
            },
            {
                action: 'output',
                label: '$(output) ' + vscode.l10n.t('Show Output'),
                description: vscode.l10n.t('Open output channel'),
                detail: vscode.l10n.t('View server logs and output'),
            },
            {
                action: 'syntaxTree',
                label: '$(symbol-structure) ' + vscode.l10n.t('Show Syntax Tree'),
                description: vscode.l10n.t('View syntax tree for current file'),
                detail: vscode.l10n.t('Display the syntax tree of the active Lua file'),
            }
        );

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: vscode.l10n.t('EmmyLua Language Server'),
            title: vscode.l10n.t('Server Control'),
        });

        if (!selected) {
            return;
        }

        // Execute selected action
        switch (selected.action) {
            case 'restart':
                await vscode.commands.executeCommand('emmy.restartServer');
                break;
            case 'stop':
                await vscode.commands.executeCommand('emmy.stopServer');
                break;
            case 'start':
                await vscode.commands.executeCommand('emmy.startServer');
                break;
            case 'info':
                this.showServerInfo();
                break;
            case 'diagnostics':
                await vscode.commands.executeCommand('emmy.showServerDiagnostics');
                break;
            case 'output':
                this._client?.outputChannel?.show();
                break;
            case 'syntaxTree':
                await vscode.commands.executeCommand('emmy.showSyntaxTree');
                break;
        }
    }

    /**
     * Show detailed server information
     */
    private showServerInfo(): void {
        const info: string[] = [
            '# EmmyLua Language Server',
            '',
            `**${vscode.l10n.t('Status:')}** ${this._serverStatus.state}`,
        ];

        if (this._serverStatus.message) {
            info.push(`**Message:** ${this._serverStatus.message}`);
        }

        if (this.debugMode) {
            info.push('', `**Debug Mode:** Enabled`);
        }

        if (this._serverStatus.details) {
            info.push('', '## Details', '', this._serverStatus.details);
        }

        const doc = vscode.workspace.openTextDocument({
            content: info.join('\n'),
            language: 'markdown',
        });

        doc.then((document) => {
            vscode.window.showTextDocument(document, {
                preview: true,
                viewColumn: vscode.ViewColumn.Beside,
            });
        });
    }

    // ==================== Private Methods ====================

    /**
     * Update status bar display
     */
    private updateStatusBar(): void {
        const config = this.getStatusBarConfig();

        this._statusBar.text = `${config.icon}EmmyLua`;
        this._statusBar.color = config.color;
        this._statusBar.backgroundColor = config.backgroundColor;
        this._statusBar.tooltip = this.createTooltip();
        this._statusBar.show();

        this._languageStatus.text = this.getLanguageStatusText();
        this._languageStatus.detail = this.getLanguageStatusDetail();
        this._languageStatus.busy =
            this._serverStatus.state === ServerState.Starting ||
            this._serverStatus.state === ServerState.Stopping;
        this._languageStatus.severity = this.getLanguageStatusSeverity();
    }

    private getLanguageStatusText(): string {
        const textByState: Record<ServerState, string> = {
            [ServerState.Starting]: vscode.l10n.t('EmmyLua: starting server'),
            [ServerState.Running]: vscode.l10n.t('EmmyLua: server running'),
            [ServerState.Stopping]: vscode.l10n.t('EmmyLua: stopping server'),
            [ServerState.Stopped]: vscode.l10n.t('EmmyLua: server stopped'),
            [ServerState.Warning]: vscode.l10n.t('EmmyLua: server warning'),
            [ServerState.Error]: vscode.l10n.t('EmmyLua: server error'),
        };

        return textByState[this._serverStatus.state];
    }

    private getLanguageStatusDetail(): string {
        const detailParts = [this._serverStatus.message, this._serverStatus.details]
            .filter((part): part is string => Boolean(part?.trim()))
            .map((part) => part.trim());

        return detailParts.join('\n\n') || vscode.l10n.t('Open server control for details and actions.');
    }

    private getLanguageStatusSeverity(): vscode.LanguageStatusSeverity {
        if (this._serverStatus.state === ServerState.Error) {
            return vscode.LanguageStatusSeverity.Error;
        }

        if (this._serverStatus.state === ServerState.Warning) {
            return vscode.LanguageStatusSeverity.Warning;
        }

        return vscode.LanguageStatusSeverity.Information;
    }

    /**
     * Get status bar configuration based on current state
     */
    private getStatusBarConfig(): StatusBarConfig {
        const configs: Record<ServerState, StatusBarConfig> = {
            [ServerState.Starting]: {
                icon: '$(sync~spin) ',
            },
            [ServerState.Running]: {
                icon: '$(check) ',
            },
            [ServerState.Stopping]: {
                icon: '$(sync~spin) ',
            },
            [ServerState.Stopped]: {
                icon: '$(circle-slash) ',
            },
            [ServerState.Warning]: {
                icon: '$(warning) ',
                color: new vscode.ThemeColor('statusBarItem.warningForeground'),
                backgroundColor: new vscode.ThemeColor('statusBarItem.warningBackground'),
            },
            [ServerState.Error]: {
                icon: '$(error) ',
                color: new vscode.ThemeColor('statusBarItem.errorForeground'),
                backgroundColor: new vscode.ThemeColor('statusBarItem.errorBackground'),
            },
        };

        return configs[this._serverStatus.state];
    }

    /**
     * Create tooltip content
     */
    private createTooltip(): vscode.MarkdownString {
        const tooltip = new vscode.MarkdownString('', true);
        tooltip.isTrusted = true;

        // Title
        tooltip.appendMarkdown(`**${vscode.l10n.t('EmmyLua Language Server')}**\n\n`);
        tooltip.appendMarkdown('---\n\n');

        // Status
        tooltip.appendMarkdown(`${vscode.l10n.t('Status:')} \`${this._serverStatus.state}\`\n\n`);

        const actions = this.getTooltipActions();
        if (actions.length) {
            const links = actions.map((action) => {
                const tooltipText = action.tooltip
                    ? ` "${action.tooltip.replace(/"/g, '\\"')}"`
                    : '';
                return `[${action.icon} ${action.label}](command:${action.command}${tooltipText})`;
            });
            tooltip.appendMarkdown(links.join('\n\n'));
            tooltip.appendMarkdown('\n\n');
        }

        return tooltip;
    }

    /**
     * Quick actions shown in the tooltip
     */
    private getTooltipActions(): TooltipAction[] {
        const actions: TooltipAction[] = [];
        const state = this._serverStatus.state;

        if (state !== ServerState.Stopped && state !== ServerState.Stopping) {
            actions.push({
                label: vscode.l10n.t('Stop server'),
                command: 'emmy.stopServer',
                icon: '$(stop-circle)',
                tooltip: vscode.l10n.t('Stop the EmmyLua language server'),
            });
        }

        actions.push({
            label: vscode.l10n.t('Restart server'),
            command: 'emmy.restartServer',
            icon: '$(debug-restart)',
            tooltip: vscode.l10n.t('Restart the EmmyLua language server'),
        });
        return actions;
    }

    /**
     * Dispose all resources
     */
    dispose(): void {
        this._client?.stop();
        this._disposables.forEach((disposable) => disposable.dispose());
    }
}
