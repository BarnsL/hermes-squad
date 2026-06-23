/**
 * ============================================================================
 * HERMES SQUAD — TUI Mode Entry Point
 * ============================================================================
 *
 * Terminal User Interface mode for Hermes Squad. This provides the Claude Squad
 * experience — a keyboard-driven terminal interface for managing multiple AI
 * agent sessions without needing a desktop GUI.
 *
 * LINEAGE:
 * --------
 * Claude Squad used a Go-based TUI (bubbletea) with tmux for session isolation.
 * Hermes Squad's TUI mode uses blessed (ncurses-like) for the terminal UI and
 * node-pty for cross-platform pseudo-terminal management (no tmux dependency).
 *
 * FEATURES:
 * ---------
 * - Split-pane view: session list + active terminal output
 * - Keyboard shortcuts matching Claude Squad conventions (j/k navigate, Enter attach)
 * - Status bar showing agent type, git branch, task progress
 * - Session output preview without full attachment
 * - Quick-launch panel for spawning new agent sessions
 *
 * INTEGRATION:
 * -----------
 * - Same core subsystems as Electron mode (SessionManager, SkillManager, etc.)
 * - ACP/MCP servers still run in background (headless protocol mode)
 * - Can be launched from Quick Desktop via ACP to provide embedded terminal
 *
 * CONFIGURATION:
 * -------------
 * Launch with: hermes-squad --tui
 * Or set: HERMES_SQUAD_MODE=tui
 *
 * Keybindings (Claude Squad compatible):
 *   j/k       — Navigate sessions
 *   Enter     — Attach to session (fullscreen terminal)
 *   Escape    — Detach from session
 *   n         — New session dialog
 *   d         — Delete/terminate session
 *   p         — Pause session
 *   r         — Resume session
 *   s         — Skills panel
 *   m         — Memory search
 *   /         — Filter/search sessions
 *   q         — Quit
 *   ?         — Help
 */

import blessed from 'blessed';
import pino from 'pino';
import { EventEmitter } from 'eventemitter3';

import { SessionManager } from '../core/session-manager.js';
import { AgentRegistry } from '../core/agent-registry.js';
import { WorkspaceIsolator } from '../core/workspace-isolator.js';
import { ACPServer } from '../acp/server.js';
import { MCPServer } from '../mcp/server.js';
import { SkillManager } from '../skills/skill-manager.js';
import { SkillStore } from '../skills/skill-store.js';
import { MemoryEngine } from '../memory/memory-engine.js';
import { Scheduler } from '../cron/scheduler.js';

import type { HermesSquadConfig, HermesSquadEvents } from '../main.js';
import type { SessionInfo } from '../core/session-manager.js';

// ─── TUI State ──────────────────────────────────────────────────────────────

interface TUIState {
  /** Currently selected session index in the list */
  selectedIndex: number;
  /** Whether we're in attached (fullscreen terminal) mode */
  attached: boolean;
  /** ID of the attached session, if any */
  attachedSessionId: string | null;
  /** Current filter string for session list */
  filter: string;
  /** Whether the help overlay is visible */
  helpVisible: boolean;
  /** Whether the new-session dialog is open */
  newSessionDialogOpen: boolean;
}

// ─── TUI Application ────────────────────────────────────────────────────────

/**
 * The TUI application provides a blessed-based terminal interface that
 * mirrors the Claude Squad workflow: list sessions on the left, preview
 * output on the right, attach for full interaction.
 */
class HermesSquadTUI {
  private readonly config: HermesSquadConfig;
  private readonly logger: pino.Logger;
  private readonly bus: EventEmitter<HermesSquadEvents>;

  // Core systems (same as Electron mode)
  private sessionManager!: SessionManager;
  private agentRegistry!: AgentRegistry;
  private workspaceIsolator!: WorkspaceIsolator;
  private skillManager!: SkillManager;
  private memoryEngine!: MemoryEngine;

  // Blessed UI elements
  private screen!: blessed.Widgets.Screen;
  private sessionList!: blessed.Widgets.ListElement;
  private previewBox!: blessed.Widgets.BoxElement;
  private statusBar!: blessed.Widgets.BoxElement;
  private inputBar!: blessed.Widgets.TextboxElement;

  // UI state
  private state: TUIState = {
    selectedIndex: 0,
    attached: false,
    attachedSessionId: null,
    filter: '',
    helpVisible: false,
    newSessionDialogOpen: false,
  };

  constructor() {
    this.config = this.resolveConfig();
    // In TUI mode, log to file to avoid corrupting the terminal display
    this.logger = pino({
      level: this.config.logLevel,
      transport: {
        target: 'pino/file',
        options: { destination: `${this.config.dataDir}/hermes-squad.log` },
      },
    });
    this.bus = new EventEmitter<HermesSquadEvents>();
  }

  private resolveConfig(): HermesSquadConfig {
    const home = process.env.HOME || process.env.USERPROFILE || '~';
    return {
      mode: 'tui',
      dataDir: process.env.HERMES_SQUAD_DATA || `${home}/.hermes-squad`,
      port: parseInt(process.env.HERMES_SQUAD_PORT || '7437', 10),
      logLevel: (process.env.HERMES_SQUAD_LOG_LEVEL as HermesSquadConfig['logLevel']) || 'info',
      acpEnabled: process.env.HERMES_SQUAD_ACP !== 'false',
      mcpEnabled: process.env.HERMES_SQUAD_MCP !== 'false',
      gatewayEnabled: false, // Gateway not typically needed in TUI mode
      cronEnabled: process.env.HERMES_SQUAD_CRON !== 'false',
    };
  }

  /**
   * Initialize all core subsystems and build the TUI layout.
   */
  async start(): Promise<void> {
    // Initialize core (same sequence as Electron mode)
    this.memoryEngine = new MemoryEngine(this.config.dataDir, this.logger);
    await this.memoryEngine.initialize();

    const skillStore = new SkillStore(this.config.dataDir, this.logger);
    await skillStore.initialize();

    this.agentRegistry = new AgentRegistry(this.logger);
    this.workspaceIsolator = new WorkspaceIsolator(this.config.dataDir, this.logger);
    this.sessionManager = new SessionManager(
      this.agentRegistry,
      this.workspaceIsolator,
      this.bus,
      this.logger
    );

    this.skillManager = new SkillManager(
      skillStore,
      this.memoryEngine,
      this.sessionManager,
      this.bus,
      this.logger
    );
    await this.skillManager.initialize();

    // Build terminal UI
    this.buildScreen();
    this.bindKeys();
    this.bindEvents();

    // Start protocol servers in background
    if (this.config.acpEnabled) {
      const acpServer = new ACPServer(
        this.sessionManager,
        this.skillManager,
        this.config.port,
        this.logger
      );
      await acpServer.start();
    }

    // Render initial state
    await this.refreshSessionList();
    this.screen.render();

    this.logger.info('TUI mode started');
  }

  /**
   * Construct the blessed screen layout.
   *
   * Layout (Claude Squad style):
   * ┌─────────────────┬──────────────────────────────────────┐
   * │  SESSIONS       │  PREVIEW / TERMINAL OUTPUT           │
   * │                 │                                      │
   * │  > session-1    │  $ claude code output here...        │
   * │    session-2    │  > Analyzing codebase...             │
   * │    session-3    │  > Writing tests...                  │
   * │                 │                                      │
   * ├─────────────────┴──────────────────────────────────────┤
   * │ [hermes-squad] 3 sessions | ACP:✓ MCP:✓ | ?=help      │
   * └────────────────────────────────────────────────────────┘
   */
  private buildScreen(): void {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Hermes Squad',
      cursor: { artificial: true, shape: 'line', blink: true, color: null },
    });

    // Left panel: session list
    this.sessionList = blessed.list({
      parent: this.screen,
      label: ' Sessions ',
      top: 0,
      left: 0,
      width: '30%',
      height: '100%-1', // Leave room for status bar
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        selected: { bg: 'blue', fg: 'white', bold: true },
        item: { fg: 'white' },
        label: { fg: 'cyan', bold: true },
      },
      keys: true,
      vi: true, // vim-style navigation (j/k)
      mouse: true,
      scrollable: true,
      scrollbar: { ch: '│', style: { fg: 'cyan' } },
    });

    // Right panel: output preview
    this.previewBox = blessed.box({
      parent: this.screen,
      label: ' Preview ',
      top: 0,
      left: '30%',
      width: '70%',
      height: '100%-1',
      border: { type: 'line' },
      style: {
        border: { fg: 'green' },
        label: { fg: 'green', bold: true },
      },
      scrollable: true,
      scrollbar: { ch: '│', style: { fg: 'green' } },
      content: '{center}No session selected{/center}\n\n{center}Press [n] to create a new session{/center}',
      tags: true, // Enable blessed markup tags
    });

    // Bottom status bar
    this.statusBar = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      style: { bg: 'blue', fg: 'white' },
      content: ' [hermes-squad] Ready | j/k:navigate | n:new | Enter:attach | ?:help',
      tags: true,
    });
  }

  /**
   * Bind keyboard shortcuts — designed to match Claude Squad's keybinding
   * conventions while extending for Hermes-specific features.
   */
  private bindKeys(): void {
    // Quit
    this.screen.key(['q', 'C-c'], () => this.quit());

    // Navigation (vim-style, like Claude Squad)
    this.screen.key(['j', 'down'], () => this.navigateDown());
    this.screen.key(['k', 'up'], () => this.navigateUp());

    // Session actions
    this.screen.key(['enter'], () => this.attachToSession());
    this.screen.key(['escape'], () => this.detachFromSession());
    this.screen.key(['n'], () => this.openNewSessionDialog());
    this.screen.key(['d'], () => this.terminateSession());
    this.screen.key(['p'], () => this.pauseSession());
    this.screen.key(['r'], () => this.resumeSession());

    // Hermes-specific features
    this.screen.key(['s'], () => this.openSkillsPanel());
    this.screen.key(['m'], () => this.openMemorySearch());
    this.screen.key(['/'], () => this.startFilter());

    // Help
    this.screen.key(['?'], () => this.toggleHelp());
  }

  /**
   * Subscribe to event bus for live UI updates.
   */
  private bindEvents(): void {
    this.bus.on('session:created', () => this.refreshSessionList());
    this.bus.on('session:terminated', () => this.refreshSessionList());
    this.bus.on('session:output', (sessionId, data) => {
      // Update preview if this is the selected session
      if (this.getSelectedSessionId() === sessionId && !this.state.attached) {
        this.previewBox.setContent(this.previewBox.getContent() + data);
        this.previewBox.setScrollPerc(100);
        this.screen.render();
      }
    });
  }

  // ─── Navigation ─────────────────────────────────────────────────────────

  private navigateDown(): void {
    const sessions = this.sessionManager.listSessions();
    if (this.state.selectedIndex < sessions.length - 1) {
      this.state.selectedIndex++;
      this.sessionList.select(this.state.selectedIndex);
      this.updatePreview();
      this.screen.render();
    }
  }

  private navigateUp(): void {
    if (this.state.selectedIndex > 0) {
      this.state.selectedIndex--;
      this.sessionList.select(this.state.selectedIndex);
      this.updatePreview();
      this.screen.render();
    }
  }

  // ─── Session Actions ────────────────────────────────────────────────────

  private async attachToSession(): Promise<void> {
    const sessionId = this.getSelectedSessionId();
    if (!sessionId) return;

    this.state.attached = true;
    this.state.attachedSessionId = sessionId;

    // Hide list, make preview fullscreen (like Claude Squad's attach behavior)
    this.sessionList.hide();
    this.previewBox.left = 0;
    this.previewBox.width = '100%';
    this.previewBox.setLabel(` Attached: ${sessionId} (Esc to detach) `);
    this.statusBar.setContent(' [ATTACHED] Esc:detach | Terminal I/O active');

    await this.sessionManager.attachSession(sessionId);
    this.screen.render();
  }

  private detachFromSession(): void {
    if (!this.state.attached) return;

    this.state.attached = false;
    this.state.attachedSessionId = null;

    // Restore split layout
    this.sessionList.show();
    this.previewBox.left = '30%';
    this.previewBox.width = '70%';
    this.previewBox.setLabel(' Preview ');
    this.statusBar.setContent(' [hermes-squad] j/k:navigate | n:new | Enter:attach | ?:help');

    this.screen.render();
  }

  private async openNewSessionDialog(): Promise<void> {
    // Show a dialog with agent selection
    const agents = this.agentRegistry.listAgents();
    const agentNames = agents.map((a) => `${a.icon} ${a.name} (${a.id})`);

    const dialog = blessed.list({
      parent: this.screen,
      label: ' New Session — Select Agent ',
      top: 'center',
      left: 'center',
      width: '50%',
      height: '50%',
      border: { type: 'line' },
      style: {
        border: { fg: 'yellow' },
        selected: { bg: 'yellow', fg: 'black' },
        label: { fg: 'yellow', bold: true },
      },
      keys: true,
      vi: true,
      items: agentNames,
    });

    dialog.on('select', async (_item: any, index: number) => {
      const agent = agents[index];
      dialog.destroy();
      await this.sessionManager.createSession({
        agentId: agent.id,
        name: `${agent.name}-${Date.now()}`,
      });
      await this.refreshSessionList();
      this.screen.render();
    });

    dialog.key(['escape'], () => {
      dialog.destroy();
      this.screen.render();
    });

    dialog.focus();
    this.screen.render();
  }

  private async terminateSession(): Promise<void> {
    const sessionId = this.getSelectedSessionId();
    if (!sessionId) return;
    await this.sessionManager.terminateSession(sessionId);
    await this.refreshSessionList();
  }

  private async pauseSession(): Promise<void> {
    const sessionId = this.getSelectedSessionId();
    if (sessionId) await this.sessionManager.pauseSession(sessionId);
  }

  private async resumeSession(): Promise<void> {
    const sessionId = this.getSelectedSessionId();
    if (sessionId) await this.sessionManager.resumeSession(sessionId);
  }

  // ─── Hermes Features ────────────────────────────────────────────────────

  private openSkillsPanel(): void {
    const skills = this.skillManager.listSkills();
    const box = blessed.box({
      parent: this.screen,
      label: ' Skills ',
      top: 'center',
      left: 'center',
      width: '60%',
      height: '60%',
      border: { type: 'line' },
      style: { border: { fg: 'magenta' }, label: { fg: 'magenta', bold: true } },
      content: skills.map((s) => `  ${s.name} — ${s.description}`).join('\n') || '  No skills learned yet',
      scrollable: true,
      keys: true,
    });

    box.key(['escape', 'q'], () => { box.destroy(); this.screen.render(); });
    box.focus();
    this.screen.render();
  }

  private openMemorySearch(): void {
    // TODO: Implement memory search dialog with text input
    this.statusBar.setContent(' Memory search: type query and press Enter');
    this.screen.render();
  }

  private startFilter(): void {
    // TODO: Implement session filtering
    this.statusBar.setContent(' Filter: (type to filter sessions)');
    this.screen.render();
  }

  private toggleHelp(): void {
    this.state.helpVisible = !this.state.helpVisible;
    if (this.state.helpVisible) {
      const help = blessed.box({
        parent: this.screen,
        label: ' Hermes Squad — Keyboard Shortcuts ',
        top: 'center',
        left: 'center',
        width: '70%',
        height: '70%',
        border: { type: 'line' },
        style: { border: { fg: 'white' }, label: { fg: 'white', bold: true } },
        content: [
          '',
          '  Navigation:',
          '    j / ↓     Move selection down',
          '    k / ↑     Move selection up',
          '',
          '  Session Management:',
          '    Enter     Attach to session (fullscreen)',
          '    Escape    Detach from session',
          '    n         New session',
          '    d         Terminate session',
          '    p         Pause session',
          '    r         Resume session',
          '',
          '  Hermes Features:',
          '    s         Skills panel',
          '    m         Memory search',
          '    /         Filter sessions',
          '',
          '  General:',
          '    ?         Toggle this help',
          '    q / Ctrl-C  Quit',
          '',
        ].join('\n'),
        scrollable: true,
        keys: true,
      });
      help.key(['escape', '?', 'q'], () => {
        this.state.helpVisible = false;
        help.destroy();
        this.screen.render();
      });
      help.focus();
    }
    this.screen.render();
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private getSelectedSessionId(): string | null {
    const sessions = this.sessionManager.listSessions();
    return sessions[this.state.selectedIndex]?.id || null;
  }

  private async refreshSessionList(): Promise<void> {
    const sessions = this.sessionManager.listSessions();
    const items = sessions.map((s: SessionInfo) => {
      const statusIcon = s.status === 'running' ? '●' : s.status === 'paused' ? '◐' : '○';
      return ` ${statusIcon} ${s.name} [${s.agentId}]`;
    });
    this.sessionList.setItems(items);
    this.screen.render();
  }

  private updatePreview(): void {
    const sessionId = this.getSelectedSessionId();
    if (!sessionId) {
      this.previewBox.setContent('No session selected');
      return;
    }
    const output = this.sessionManager.getSessionOutput(sessionId);
    this.previewBox.setContent(output || '(no output yet)');
    this.previewBox.setScrollPerc(100);
  }

  private async quit(): Promise<void> {
    await this.sessionManager.terminateAll();
    await this.memoryEngine.close();
    process.exit(0);
  }
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const tui = new HermesSquadTUI();
  await tui.start();
}

main().catch((err) => {
  console.error('Fatal error in TUI mode:', err);
  process.exit(1);
});

export { HermesSquadTUI };
