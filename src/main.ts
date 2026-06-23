/**
 * ============================================================================
 * HERMES SQUAD — Main Process Entry Point (Electron)
 * ============================================================================
 *
 * This is the Electron main process entry point for Hermes Squad. It
 * bootstraps the desktop application with:
 *
 * - Multi-agent session management (from Claude Squad)
 * - Self-improving skills engine (from Hermes Desktop)
 * - ACP server for receiving tasks from Quick Desktop / Kiro IDE
 * - MCP server for exposing tools to Quick's agent system
 * - Gateway connections for Slack/Discord/Telegram messaging
 * - Scheduled automation via cron engine
 *
 * ARCHITECTURE NOTES:
 * ------------------
 * Claude Squad was a Go-based TUI app that managed tmux sessions with
 * AI coding agents. Hermes Desktop was a Node.js Electron app with
 * self-improving capabilities. Hermes Squad merges both paradigms:
 *
 * 1. Electron provides the desktop GUI shell (like Hermes Desktop)
 * 2. The TUI mode (`--tui` flag) provides terminal-native UX (like Claude Squad)
 * 3. node-pty replaces tmux for cross-platform terminal multiplexing
 * 4. The skills system learns from every interaction
 * 5. ACP/MCP bridges connect to the Amazon Quick / Kiro ecosystem
 *
 * INTEGRATION POINTS:
 * ------------------
 * - Quick Desktop: Sends tasks via ACP → Hermes Squad orchestrates agents
 * - Kiro IDE: Bidirectional ACP — delegate to Kiro or receive from Kiro
 * - MCP: Hermes Squad exposes `spawn_agent`, `query_memory`, `run_skill`
 *   as MCP tools that Quick can invoke directly
 *
 * CONFIGURATION:
 * -------------
 * - HERMES_SQUAD_MODE: "electron" | "tui" | "headless" (default: "electron")
 * - HERMES_SQUAD_PORT: ACP/MCP server port (default: 7437)
 * - HERMES_SQUAD_DATA: Data directory (default: ~/.hermes-squad/)
 * - HERMES_SQUAD_LOG_LEVEL: "debug" | "info" | "warn" | "error"
 */

import { app, BrowserWindow, ipcMain, protocol } from 'electron';
import { EventEmitter } from 'eventemitter3';
import pino from 'pino';

// Core subsystems
import { SessionManager } from './core/session-manager.js';
import { AgentRegistry } from './core/agent-registry.js';
import { WorkspaceIsolator } from './core/workspace-isolator.js';

// Protocol servers
import { ACPServer } from './acp/server.js';
import { ACPClient } from './acp/client.js';
import { MCPServer } from './mcp/server.js';

// Intelligence layer
import { SkillManager } from './skills/skill-manager.js';
import { SkillStore } from './skills/skill-store.js';
import { MemoryEngine } from './memory/memory-engine.js';

// Automation & messaging
import { Gateway } from './gateway/gateway.js';
import { Scheduler } from './cron/scheduler.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Application-wide configuration resolved from environment, config file,
 * and CLI arguments (in that priority order).
 */
export interface HermesSquadConfig {
  /** Runtime mode — determines UI surface */
  mode: 'electron' | 'tui' | 'headless';
  /** Base data directory for all persistent state */
  dataDir: string;
  /** Port for ACP JSON-RPC and MCP stdio server */
  port: number;
  /** Logging verbosity */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Whether to start the ACP server on boot */
  acpEnabled: boolean;
  /** Whether to register as an MCP server */
  mcpEnabled: boolean;
  /** Whether to connect messaging gateways */
  gatewayEnabled: boolean;
  /** Whether to run the cron scheduler */
  cronEnabled: boolean;
}

/**
 * Central event bus types — all subsystems communicate through this bus.
 * This loose coupling allows the TUI, Electron, and headless modes to
 * share the same core logic.
 */
export interface HermesSquadEvents {
  'session:created': (sessionId: string) => void;
  'session:terminated': (sessionId: string) => void;
  'session:output': (sessionId: string, data: string) => void;
  'agent:registered': (agentId: string) => void;
  'skill:learned': (skillId: string) => void;
  'skill:executed': (skillId: string, success: boolean) => void;
  'memory:stored': (key: string) => void;
  'acp:task-received': (taskId: string) => void;
  'acp:task-completed': (taskId: string) => void;
  'mcp:tool-invoked': (toolName: string) => void;
  'gateway:message': (platform: string, message: unknown) => void;
  'cron:triggered': (jobId: string) => void;
  'app:ready': () => void;
  'app:error': (error: Error) => void;
}

// ─── Application Kernel ─────────────────────────────────────────────────────

/**
 * The HermesSquadApp class is the central orchestrator. It initializes all
 * subsystems and manages the application lifecycle. Both Electron and TUI
 * modes instantiate this class — the difference is only in the UI layer.
 */
class HermesSquadApp {
  private readonly config: HermesSquadConfig;
  private readonly logger: pino.Logger;
  private readonly bus: EventEmitter<HermesSquadEvents>;

  // Core subsystems
  private sessionManager!: SessionManager;
  private agentRegistry!: AgentRegistry;
  private workspaceIsolator!: WorkspaceIsolator;

  // Protocol layers
  private acpServer?: ACPServer;
  private acpClient!: ACPClient;
  private mcpServer?: MCPServer;

  // Intelligence
  private skillManager!: SkillManager;
  private skillStore!: SkillStore;
  private memoryEngine!: MemoryEngine;

  // Automation
  private gateway?: Gateway;
  private scheduler?: Scheduler;

  // Electron
  private mainWindow?: BrowserWindow;

  constructor() {
    this.config = this.resolveConfig();
    this.logger = pino({
      level: this.config.logLevel,
      transport: { target: 'pino-pretty' },
    });
    this.bus = new EventEmitter<HermesSquadEvents>();

    this.logger.info({ config: this.config }, 'Hermes Squad initializing');
  }

  /**
   * Resolve configuration from environment variables, config file, and defaults.
   * Priority: env > config file > defaults
   */
  private resolveConfig(): HermesSquadConfig {
    const home = process.env.HOME || process.env.USERPROFILE || '~';
    return {
      mode: (process.env.HERMES_SQUAD_MODE as HermesSquadConfig['mode']) || 'electron',
      dataDir: process.env.HERMES_SQUAD_DATA || `${home}/.hermes-squad`,
      port: parseInt(process.env.HERMES_SQUAD_PORT || '7437', 10),
      logLevel: (process.env.HERMES_SQUAD_LOG_LEVEL as HermesSquadConfig['logLevel']) || 'info',
      acpEnabled: process.env.HERMES_SQUAD_ACP !== 'false',
      mcpEnabled: process.env.HERMES_SQUAD_MCP !== 'false',
      gatewayEnabled: process.env.HERMES_SQUAD_GATEWAY === 'true',
      cronEnabled: process.env.HERMES_SQUAD_CRON !== 'false',
    };
  }

  /**
   * Bootstrap all subsystems in dependency order.
   * This is the main initialization sequence — order matters.
   */
  async bootstrap(): Promise<void> {
    try {
      // Layer 1: Storage & Memory (no dependencies)
      this.memoryEngine = new MemoryEngine(this.config.dataDir, this.logger);
      await this.memoryEngine.initialize();

      this.skillStore = new SkillStore(this.config.dataDir, this.logger);
      await this.skillStore.initialize();

      // Layer 2: Core runtime (depends on storage)
      this.agentRegistry = new AgentRegistry(this.logger);
      this.workspaceIsolator = new WorkspaceIsolator(this.config.dataDir, this.logger);
      this.sessionManager = new SessionManager(
        this.agentRegistry,
        this.workspaceIsolator,
        this.bus,
        this.logger
      );

      // Layer 3: Intelligence (depends on core + storage)
      this.skillManager = new SkillManager(
        this.skillStore,
        this.memoryEngine,
        this.sessionManager,
        this.bus,
        this.logger
      );
      await this.skillManager.initialize();

      // Layer 4: Protocol servers (depends on all above)
      this.acpClient = new ACPClient(this.logger);

      if (this.config.acpEnabled) {
        this.acpServer = new ACPServer(
          this.sessionManager,
          this.skillManager,
          this.config.port,
          this.logger
        );
        await this.acpServer.start();
        this.logger.info({ port: this.config.port }, 'ACP server started');
      }

      if (this.config.mcpEnabled) {
        this.mcpServer = new MCPServer(
          this.sessionManager,
          this.skillManager,
          this.memoryEngine,
          this.logger
        );
        await this.mcpServer.start();
        this.logger.info('MCP server started (stdio mode)');
      }

      // Layer 5: Automation (optional, depends on core)
      if (this.config.gatewayEnabled) {
        this.gateway = new Gateway(this.sessionManager, this.skillManager, this.bus, this.logger);
        await this.gateway.connect();
      }

      if (this.config.cronEnabled) {
        this.scheduler = new Scheduler(
          this.sessionManager,
          this.skillManager,
          this.config.dataDir,
          this.logger
        );
        await this.scheduler.start();
      }

      this.bus.emit('app:ready');
      this.logger.info('Hermes Squad ready — all subsystems initialized');
    } catch (error) {
      this.logger.fatal({ error }, 'Fatal error during bootstrap');
      this.bus.emit('app:error', error as Error);
      throw error;
    }
  }

  /**
   * Create the Electron BrowserWindow and load the renderer.
   * Only called in 'electron' mode.
   */
  async createWindow(): Promise<void> {
    this.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 800,
      minHeight: 600,
      title: 'Hermes Squad',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: `${__dirname}/ui/electron/preload.js`,
      },
      // Dark theme by default — matches developer aesthetic
      backgroundColor: '#1a1b26',
      titleBarStyle: 'hiddenInset',
    });

    // In production, load from file; in dev, load from Vite dev server
    const isDev = !app.isPackaged;
    if (isDev) {
      await this.mainWindow.loadURL('http://localhost:5173');
      this.mainWindow.webContents.openDevTools();
    } else {
      await this.mainWindow.loadFile('dist/ui/electron/index.html');
    }

    // Wire IPC handlers for renderer ↔ main communication
    this.setupIPC();
  }

  /**
   * Set up IPC handlers between Electron renderer and main process.
   * These bridge the UI layer to the core subsystems.
   */
  private setupIPC(): void {
    // Session management IPC
    ipcMain.handle('sessions:list', () => this.sessionManager.listSessions());
    ipcMain.handle('sessions:create', (_, opts) => this.sessionManager.createSession(opts));
    ipcMain.handle('sessions:terminate', (_, id) => this.sessionManager.terminateSession(id));
    ipcMain.handle('sessions:attach', (_, id) => this.sessionManager.attachSession(id));

    // Agent registry IPC
    ipcMain.handle('agents:list', () => this.agentRegistry.listAgents());
    ipcMain.handle('agents:get', (_, id) => this.agentRegistry.getAgent(id));

    // Skills IPC
    ipcMain.handle('skills:list', () => this.skillManager.listSkills());
    ipcMain.handle('skills:execute', (_, id, ctx) => this.skillManager.executeSkill(id, ctx));

    // Memory IPC
    ipcMain.handle('memory:search', (_, query) => this.memoryEngine.search(query));
    ipcMain.handle('memory:store', (_, entry) => this.memoryEngine.store(entry));

    // Forward session output to renderer for live terminal display
    this.bus.on('session:output', (sessionId, data) => {
      this.mainWindow?.webContents.send('session:output', { sessionId, data });
    });
  }

  /**
   * Graceful shutdown — cleanly terminate all subsystems.
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down Hermes Squad...');

    // Reverse initialization order for clean teardown
    await this.scheduler?.stop();
    await this.gateway?.disconnect();
    await this.mcpServer?.stop();
    await this.acpServer?.stop();
    await this.sessionManager.terminateAll();
    await this.memoryEngine.close();

    this.logger.info('Hermes Squad shutdown complete');
  }
}

// ─── Electron App Lifecycle ──────────────────────────────────────────────────

const hermesApp = new HermesSquadApp();

app.whenReady().then(async () => {
  await hermesApp.bootstrap();
  await hermesApp.createWindow();

  // macOS: re-create window when dock icon is clicked
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await hermesApp.createWindow();
    }
  });
});

// Quit when all windows are closed (except macOS convention)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean shutdown on quit
app.on('before-quit', async () => {
  await hermesApp.shutdown();
});

// Handle uncaught errors gracefully
process.on('unhandledRejection', (reason) => {
  console.error('[Hermes Squad] Unhandled rejection:', reason);
});

export { HermesSquadApp, HermesSquadConfig, HermesSquadEvents };
