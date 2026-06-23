/**
 * ============================================================================
 * HERMES SQUAD — Electron Renderer (Desktop UI Shell)
 * ============================================================================
 *
 * This is the Electron renderer process entry point — it bootstraps the
 * desktop UI for Hermes Squad. The UI provides a visual interface for
 * managing agent sessions, skills, and memory.
 *
 * UI DESIGN:
 * ---------
 * The desktop UI is a modern, dark-themed developer tool with:
 * - Left sidebar: Session list with status indicators
 * - Center: Active terminal/output view (xterm.js embedded)
 * - Right panel: Context — skills, memory, agent info
 * - Bottom bar: Quick commands, status, notifications
 *
 * LINEAGE:
 * --------
 * - Hermes Desktop: Modern Electron UI with reactive state
 * - Claude Squad: Terminal-centric UX with minimal chrome
 * - Hermes Squad: Combines both — rich UI that feels like a terminal
 *
 * ARCHITECTURE:
 * -----------
 * The renderer communicates with the main process via IPC:
 * - Renderer → Main: Command requests (create session, run skill, etc.)
 * - Main → Renderer: State updates (session output, status changes, etc.)
 *
 * The renderer is a lightweight React app (or vanilla TS for minimal deps)
 * with xterm.js for terminal rendering and a custom layout system.
 *
 * INTEGRATION POINTS:
 * ------------------
 * - IPC: Bridges to all main process subsystems
 * - xterm.js: Renders agent terminal output in real-time
 * - Notification API: Desktop notifications for session events
 * - System tray: Quick access even when window is closed
 *
 * CONFIGURATION:
 * -------------
 * - Theme: 'dark' | 'light' | 'system' (default: 'dark')
 * - Font: Terminal font family (default: 'JetBrains Mono')
 * - Layout: 'split' | 'tabs' | 'stacked' (default: 'split')
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * IPC API exposed to the renderer via preload script.
 * This is the bridge between the UI and the main process.
 */
interface HermesSquadAPI {
  // Session management
  sessions: {
    list(): Promise<SessionView[]>;
    create(options: CreateSessionView): Promise<SessionView>;
    terminate(id: string): Promise<void>;
    attach(id: string): Promise<void>;
    getOutput(id: string): Promise<string>;
    sendInput(id: string, data: string): void;
    onOutput(callback: (data: { sessionId: string; data: string }) => void): void;
  };

  // Agent info
  agents: {
    list(): Promise<AgentView[]>;
    get(id: string): Promise<AgentView | null>;
  };

  // Skills
  skills: {
    list(): Promise<SkillView[]>;
    execute(id: string, context: Record<string, unknown>): Promise<unknown>;
  };

  // Memory
  memory: {
    search(query: string): Promise<MemoryView[]>;
    store(entry: { content: string; category: string; tags: string[] }): Promise<string>;
  };

  // App
  app: {
    getVersion(): string;
    getTheme(): string;
    setTheme(theme: string): void;
    quit(): void;
  };
}

/**
 * Session as displayed in the UI.
 */
interface SessionView {
  id: string;
  name: string;
  agentId: string;
  agentIcon: string;
  status: string;
  task?: string;
  branch?: string;
  createdAt: string;
  lastActivityAt: string;
}

interface CreateSessionView {
  agentId: string;
  name?: string;
  task?: string;
  repoPath?: string;
  branch?: string;
}

interface AgentView {
  id: string;
  name: string;
  icon: string;
  description: string;
  available: boolean;
  capabilities: string[];
  costTier: string;
}

interface SkillView {
  id: string;
  name: string;
  description: string;
  category: string;
  successRate: number;
  executionCount: number;
}

interface MemoryView {
  id: string;
  content: string;
  category: string;
  tags: string[];
  createdAt: string;
  score?: number;
}

// ─── UI State ───────────────────────────────────────────────────────────────

/**
 * Application UI state — managed in the renderer process.
 */
interface AppState {
  /** All sessions */
  sessions: SessionView[];
  /** Currently selected/active session ID */
  activeSessionId: string | null;
  /** Available agents */
  agents: AgentView[];
  /** Skills library */
  skills: SkillView[];
  /** Current panel view */
  activePanel: 'sessions' | 'skills' | 'memory' | 'settings';
  /** Theme */
  theme: 'dark' | 'light';
  /** Whether the command palette is open */
  commandPaletteOpen: boolean;
  /** Notification queue */
  notifications: Array<{ id: string; text: string; type: 'info' | 'success' | 'error' }>;
}

// ─── Renderer Application ───────────────────────────────────────────────────

/**
 * Main renderer application class.
 *
 * Manages the UI lifecycle, state updates, and IPC communication.
 * This is a simplified vanilla TS implementation — in production this
 * would likely use React with xterm.js for the terminal components.
 */
class HermesSquadRenderer {
  private state: AppState;
  private api: HermesSquadAPI;

  constructor() {
    // Access the preload-exposed API
    this.api = (window as any).hermesSquad as HermesSquadAPI;

    this.state = {
      sessions: [],
      activeSessionId: null,
      agents: [],
      skills: [],
      activePanel: 'sessions',
      theme: 'dark',
      commandPaletteOpen: false,
      notifications: [],
    };
  }

  /**
   * Initialize the renderer — load initial data and set up event listeners.
   */
  async initialize(): Promise<void> {
    // Load initial data from main process
    this.state.sessions = await this.api.sessions.list();
    this.state.agents = await this.api.agents.list();
    this.state.skills = await this.api.skills.list();

    // Set up real-time output streaming
    this.api.sessions.onOutput(({ sessionId, data }) => {
      this.handleSessionOutput(sessionId, data);
    });

    // Set up keyboard shortcuts
    this.setupKeyboardShortcuts();

    // Render initial UI
    this.render();

    console.log('[Hermes Squad] Renderer initialized');
  }

  // ─── UI Actions ───────────────────────────────────────────────────────────

  /**
   * Create a new session via the UI.
   */
  async createSession(options: CreateSessionView): Promise<void> {
    try {
      const session = await this.api.sessions.create(options);
      this.state.sessions.push(session);
      this.state.activeSessionId = session.id;
      this.addNotification(`Session created: ${session.name}`, 'success');
      this.render();
    } catch (error) {
      this.addNotification(`Failed to create session: ${(error as Error).message}`, 'error');
    }
  }

  /**
   * Terminate a session via the UI.
   */
  async terminateSession(sessionId: string): Promise<void> {
    await this.api.sessions.terminate(sessionId);
    this.state.sessions = this.state.sessions.filter((s) => s.id !== sessionId);
    if (this.state.activeSessionId === sessionId) {
      this.state.activeSessionId = this.state.sessions[0]?.id ?? null;
    }
    this.addNotification('Session terminated', 'info');
    this.render();
  }

  /**
   * Switch active session (for terminal view).
   */
  selectSession(sessionId: string): void {
    this.state.activeSessionId = sessionId;
    this.render();
  }

  /**
   * Execute a skill from the UI.
   */
  async executeSkill(skillId: string): Promise<void> {
    try {
      await this.api.skills.execute(skillId, {});
      this.addNotification('Skill executed successfully', 'success');
    } catch (error) {
      this.addNotification(`Skill failed: ${(error as Error).message}`, 'error');
    }
  }

  /**
   * Search memory from the UI.
   */
  async searchMemory(query: string): Promise<MemoryView[]> {
    return this.api.memory.search(query);
  }

  // ─── Event Handlers ───────────────────────────────────────────────────────

  /**
   * Handle real-time session output for terminal display.
   */
  private handleSessionOutput(sessionId: string, data: string): void {
    // In a full implementation, this would write to an xterm.js instance
    // associated with the session. For now, we just log it.
    if (sessionId === this.state.activeSessionId) {
      // Write to active terminal view
      this.writeToTerminal(data);
    }
  }

  /**
   * Set up keyboard shortcuts (Claude Squad-inspired keybindings).
   */
  private setupKeyboardShortcuts(): void {
    document.addEventListener('keydown', (event: KeyboardEvent) => {
      // Cmd/Ctrl + K: Command palette
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        this.toggleCommandPalette();
      }

      // Cmd/Ctrl + N: New session
      if ((event.metaKey || event.ctrlKey) && event.key === 'n') {
        event.preventDefault();
        this.showNewSessionDialog();
      }

      // Cmd/Ctrl + W: Close/terminate active session
      if ((event.metaKey || event.ctrlKey) && event.key === 'w') {
        event.preventDefault();
        if (this.state.activeSessionId) {
          this.terminateSession(this.state.activeSessionId);
        }
      }

      // Cmd/Ctrl + 1-5: Switch between sessions
      if ((event.metaKey || event.ctrlKey) && event.key >= '1' && event.key <= '5') {
        event.preventDefault();
        const index = parseInt(event.key) - 1;
        if (this.state.sessions[index]) {
          this.selectSession(this.state.sessions[index].id);
        }
      }

      // Cmd/Ctrl + Shift + S: Skills panel
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 'S') {
        event.preventDefault();
        this.state.activePanel = 'skills';
        this.render();
      }

      // Cmd/Ctrl + Shift + M: Memory panel
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 'M') {
        event.preventDefault();
        this.state.activePanel = 'memory';
        this.render();
      }
    });
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  /**
   * Render the full UI.
   *
   * In a production build, this would be React with proper virtual DOM.
   * This simplified version demonstrates the layout structure.
   */
  private render(): void {
    const root = document.getElementById('app');
    if (!root) return;

    root.innerHTML = `
      <div class="hermes-squad-app ${this.state.theme}">
        <!-- Title Bar -->
        <header class="title-bar">
          <div class="title-bar-drag-region">
            <span class="app-title">⚡ Hermes Squad</span>
          </div>
          <div class="title-bar-controls">
            <button onclick="renderer.toggleCommandPalette()" title="Command Palette (⌘K)">⌘K</button>
          </div>
        </header>

        <!-- Main Layout -->
        <div class="main-layout">
          <!-- Left Sidebar: Session List -->
          <aside class="sidebar">
            <div class="sidebar-header">
              <h3>Sessions</h3>
              <button class="btn-new" onclick="renderer.showNewSessionDialog()" title="New Session (⌘N)">+</button>
            </div>
            <div class="session-list">
              ${this.renderSessionList()}
            </div>
            <div class="sidebar-footer">
              <button onclick="renderer.state.activePanel='skills'; renderer.render()">🧠 Skills</button>
              <button onclick="renderer.state.activePanel='memory'; renderer.render()">💾 Memory</button>
              <button onclick="renderer.state.activePanel='settings'; renderer.render()">⚙️</button>
            </div>
          </aside>

          <!-- Center: Terminal / Content Area -->
          <main class="content-area">
            <div class="terminal-container" id="terminal-container">
              ${this.state.activeSessionId
                ? `<div class="terminal-header">
                     <span>${this.getActiveSession()?.name ?? ''}</span>
                     <span class="session-status">${this.getActiveSession()?.status ?? ''}</span>
                   </div>
                   <div id="terminal" class="terminal-view">
                     <!-- xterm.js mounts here in production -->
                     <pre class="terminal-output">Terminal output appears here...</pre>
                   </div>`
                : `<div class="empty-state">
                     <h2>⚡ Hermes Squad</h2>
                     <p>No active session. Press ⌘N to create one.</p>
                     <div class="quick-actions">
                       ${this.state.agents.map((a) =>
                         `<button onclick="renderer.createSession({agentId:'${a.id}'})">${a.icon} ${a.name}</button>`
                       ).join('')}
                     </div>
                   </div>`
              }
            </div>
          </main>

          <!-- Right Panel: Context -->
          <aside class="context-panel">
            ${this.renderContextPanel()}
          </aside>
        </div>

        <!-- Status Bar -->
        <footer class="status-bar">
          <span class="status-left">
            ${this.state.sessions.filter((s) => s.status === 'running').length} running
            | ${this.state.skills.length} skills
          </span>
          <span class="status-right">
            ACP: ✓ | MCP: ✓ | v0.1.0
          </span>
        </footer>

        <!-- Notifications -->
        <div class="notifications">
          ${this.state.notifications.map((n) =>
            `<div class="notification notification-${n.type}">${n.text}</div>`
          ).join('')}
        </div>
      </div>
    `;
  }

  /**
   * Render the session list sidebar.
   */
  private renderSessionList(): string {
    if (this.state.sessions.length === 0) {
      return '<div class="empty-sessions">No sessions yet</div>';
    }

    return this.state.sessions.map((session) => {
      const isActive = session.id === this.state.activeSessionId;
      const statusIcon = session.status === 'running' ? '●'
        : session.status === 'paused' ? '◐'
        : session.status === 'completed' ? '✓'
        : '✗';
      const statusColor = session.status === 'running' ? 'green'
        : session.status === 'paused' ? 'yellow'
        : session.status === 'completed' ? 'gray'
        : 'red';

      return `
        <div class="session-item ${isActive ? 'active' : ''}"
             onclick="renderer.selectSession('${session.id}')">
          <span class="session-status-icon" style="color: ${statusColor}">${statusIcon}</span>
          <div class="session-info">
            <span class="session-name">${session.agentIcon} ${session.name}</span>
            <span class="session-task">${session.task?.slice(0, 40) ?? 'No task'}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Render the right context panel based on active panel selection.
   */
  private renderContextPanel(): string {
    switch (this.state.activePanel) {
      case 'skills':
        return `
          <h3>🧠 Skills Library</h3>
          <div class="skills-list">
            ${this.state.skills.map((s) => `
              <div class="skill-item" onclick="renderer.executeSkill('${s.id}')">
                <span class="skill-name">${s.name}</span>
                <span class="skill-meta">${s.category} | ${Math.round(s.successRate * 100)}% success</span>
              </div>
            `).join('')}
          </div>
        `;

      case 'memory':
        return `
          <h3>💾 Memory</h3>
          <input type="text" placeholder="Search memory..." class="memory-search"
                 onkeyup="if(event.key==='Enter')renderer.searchMemory(this.value)" />
          <div class="memory-results" id="memory-results"></div>
        `;

      case 'settings':
        return `
          <h3>⚙️ Settings</h3>
          <div class="settings-list">
            <label>Theme: <select onchange="renderer.setTheme(this.value)">
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select></label>
            <label>Max Sessions: <input type="number" value="5" min="1" max="10" /></label>
          </div>
        `;

      default:
        return `
          <h3>ℹ️ Session Info</h3>
          ${this.state.activeSessionId
            ? `<pre>${JSON.stringify(this.getActiveSession(), null, 2)}</pre>`
            : '<p>Select a session to view details</p>'
          }
        `;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private getActiveSession(): SessionView | null {
    return this.state.sessions.find((s) => s.id === this.state.activeSessionId) ?? null;
  }

  private addNotification(text: string, type: 'info' | 'success' | 'error'): void {
    const id = `notif_${Date.now()}`;
    this.state.notifications.push({ id, text, type });
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      this.state.notifications = this.state.notifications.filter((n) => n.id !== id);
      this.render();
    }, 5000);
  }

  private toggleCommandPalette(): void {
    this.state.commandPaletteOpen = !this.state.commandPaletteOpen;
    this.render();
  }

  private showNewSessionDialog(): void {
    // In production: show a modal with agent selection and task input
    const task = prompt('Enter task for new session:');
    if (task) {
      this.createSession({ agentId: 'hermes', task });
    }
  }

  private setTheme(theme: string): void {
    this.state.theme = theme as 'dark' | 'light';
    this.api.app.setTheme(theme);
    this.render();
  }

  private writeToTerminal(data: string): void {
    // In production: write to xterm.js instance
    const terminal = document.querySelector('.terminal-output');
    if (terminal) {
      terminal.textContent += data;
    }
  }
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────

// Initialize when DOM is ready
const renderer = new HermesSquadRenderer();
document.addEventListener('DOMContentLoaded', () => {
  renderer.initialize().catch(console.error);
});

// Expose for inline onclick handlers (production would use proper event delegation)
(window as any).renderer = renderer;

export { HermesSquadRenderer };
