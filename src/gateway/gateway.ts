/**
 * ============================================================================
 * HERMES SQUAD — Gateway (Multi-Platform Messaging)
 * ============================================================================
 *
 * The Gateway provides multi-platform messaging integration, allowing Hermes
 * Squad to receive tasks and send notifications via Slack, Discord, and
 * Telegram. This enables "remote control" of agent sessions from any device.
 *
 * LINEAGE FROM HERMES DESKTOP:
 * ---------------------------
 * Hermes Desktop included Slack/Discord/Telegram integration for:
 * - Receiving tasks: "Hey Hermes, deploy the staging branch"
 * - Progress updates: "Build complete ✅ — 3 tests fixed, deployed to staging"
 * - Status queries: "What's running right now?"
 * - Approval workflows: "Tests passed. Deploy to prod? [Yes/No]"
 *
 * Hermes Squad extends this with multi-agent awareness:
 * - "Spawn a Claude Code session to fix issue #1234"
 * - "What are all my agent sessions doing?"
 * - "Pause all sessions" / "Resume the testing session"
 *
 * USE CASES:
 * ---------
 * 1. Mobile task dispatch: Send coding tasks from your phone via Slack
 * 2. CI/CD integration: Bot posts results to your team channel
 * 3. Approval gates: Agent asks permission before destructive actions
 * 4. Status monitoring: Get notified when long sessions complete
 * 5. Team collaboration: Multiple devs interact with shared Hermes instance
 *
 * ARCHITECTURE:
 * -----------
 * The Gateway uses an adapter pattern — each platform implements the
 * GatewayAdapter interface. The core Gateway class routes messages to/from
 * the appropriate adapter.
 *
 * ```
 * Slack  ─┐
 * Discord ┼→ Gateway → SessionManager / SkillManager
 * Telegram┘
 * ```
 *
 * INTEGRATION POINTS:
 * ------------------
 * - SessionManager: Gateway can create/manage sessions from messages
 * - SkillManager: Gateway can trigger skills
 * - MemoryEngine: Stores important messages as external knowledge
 * - Event Bus: Subscribes to session events for notifications
 *
 * CONFIGURATION:
 * -------------
 * Platform tokens are stored in ~/.hermes-squad/gateway.yaml:
 * ```yaml
 * slack:
 *   botToken: xoxb-...
 *   appToken: xapp-...
 *   channels: ['#dev-hermes']
 * discord:
 *   botToken: ...
 *   guildId: ...
 * telegram:
 *   botToken: ...
 *   allowedChats: [123456789]
 * ```
 */

import { EventEmitter } from 'eventemitter3';
import type { Logger } from 'pino';

import type { SessionManager } from '../core/session-manager.js';
import type { SkillManager } from '../skills/skill-manager.js';
import type { HermesSquadEvents } from '../main.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Supported messaging platforms.
 */
export type GatewayPlatform = 'slack' | 'discord' | 'telegram';

/**
 * A message received from any platform (normalized format).
 */
export interface GatewayMessage {
  /** Which platform the message came from */
  platform: GatewayPlatform;
  /** Platform-specific channel/chat ID */
  channelId: string;
  /** Platform-specific user ID */
  userId: string;
  /** User display name */
  userName: string;
  /** Message text content */
  text: string;
  /** Platform-specific message ID (for threading) */
  messageId: string;
  /** Thread ID if this is a threaded reply */
  threadId?: string;
  /** Timestamp */
  timestamp: Date;
  /** Attached files (if any) */
  attachments?: Array<{ url: string; name: string; type: string }>;
}

/**
 * A message to send via the gateway.
 */
export interface GatewaySendOptions {
  /** Target platform */
  platform: GatewayPlatform;
  /** Target channel/chat ID */
  channelId: string;
  /** Message text */
  text: string;
  /** Thread ID for threaded replies */
  threadId?: string;
  /** Rich formatting blocks (platform-specific) */
  blocks?: unknown[];
}

/**
 * Interface that platform adapters must implement.
 */
export interface GatewayAdapter {
  /** Platform identifier */
  readonly platform: GatewayPlatform;
  /** Connect to the platform */
  connect(): Promise<void>;
  /** Disconnect from the platform */
  disconnect(): Promise<void>;
  /** Send a message */
  send(options: Omit<GatewaySendOptions, 'platform'>): Promise<string>;
  /** Register a message handler */
  onMessage(handler: (message: GatewayMessage) => void): void;
  /** Check if connected */
  isConnected(): boolean;
}

/**
 * Command parsed from a gateway message.
 */
interface ParsedCommand {
  /** The command type */
  type: 'spawn' | 'status' | 'terminate' | 'pause' | 'resume' | 'skill' | 'memory' | 'help' | 'unknown';
  /** Command arguments */
  args: Record<string, string>;
  /** Original message text */
  raw: string;
}

// ─── Gateway ────────────────────────────────────────────────────────────────

/**
 * Multi-platform messaging gateway for remote control of Hermes Squad.
 *
 * @example
 * ```typescript
 * const gateway = new Gateway(sessionManager, skillManager, bus, logger);
 * await gateway.connect();
 *
 * // Messages from Slack/Discord/Telegram are auto-routed to handlers
 * // Session events are auto-forwarded as notifications
 * ```
 */
export class Gateway {
  private readonly sessionManager: SessionManager;
  private readonly skillManager: SkillManager;
  private readonly bus: EventEmitter<HermesSquadEvents>;
  private readonly logger: Logger;
  private readonly adapters: Map<GatewayPlatform, GatewayAdapter> = new Map();

  /** Channels to send notifications to (per platform) */
  private readonly notificationChannels: Map<GatewayPlatform, string[]> = new Map();

  constructor(
    sessionManager: SessionManager,
    skillManager: SkillManager,
    bus: EventEmitter<HermesSquadEvents>,
    logger: Logger
  ) {
    this.sessionManager = sessionManager;
    this.skillManager = skillManager;
    this.bus = bus;
    this.logger = logger.child({ module: 'Gateway' });
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Connect all configured platform adapters and wire up event forwarding.
   */
  async connect(): Promise<void> {
    // Initialize adapters based on available configuration
    await this.initializeAdapters();

    // Wire up event bus → notification forwarding
    this.setupEventForwarding();

    this.logger.info(
      { platforms: Array.from(this.adapters.keys()) },
      'Gateway connected'
    );
  }

  /**
   * Disconnect all platform adapters.
   */
  async disconnect(): Promise<void> {
    for (const [platform, adapter] of this.adapters) {
      try {
        await adapter.disconnect();
        this.logger.info({ platform }, 'Adapter disconnected');
      } catch (error) {
        this.logger.error({ platform, error }, 'Error disconnecting adapter');
      }
    }
    this.adapters.clear();
  }

  // ─── Message Handling ─────────────────────────────────────────────────────

  /**
   * Handle an incoming message from any platform.
   * Parses commands and routes to appropriate handlers.
   */
  private async handleMessage(message: GatewayMessage): Promise<void> {
    this.logger.debug(
      { platform: message.platform, user: message.userName, text: message.text.slice(0, 50) },
      'Gateway message received'
    );

    // Emit event for other systems
    this.bus.emit('gateway:message', message.platform, message);

    // Parse command from message
    const command = this.parseCommand(message.text);

    try {
      const response = await this.executeCommand(command, message);
      if (response) {
        await this.sendReply(message, response);
      }
    } catch (error) {
      await this.sendReply(message, `❌ Error: ${(error as Error).message}`);
    }
  }

  /**
   * Parse a command from message text.
   *
   * Supported commands:
   * - "spawn [agent] [task]" — create a new session
   * - "status" — list active sessions
   * - "terminate [session-id]" — stop a session
   * - "pause [session-id]" — pause a session
   * - "resume [session-id]" — resume a session
   * - "skill [skill-id] [context]" — run a skill
   * - "memory [query]" — search memory
   * - "help" — show available commands
   */
  private parseCommand(text: string): ParsedCommand {
    const normalized = text.trim().toLowerCase();

    // Remove bot mention prefix if present
    const cleaned = normalized.replace(/^@?hermes[\s-]*squad?\s*/i, '');

    const parts = cleaned.split(/\s+/);
    const commandWord = parts[0];

    switch (commandWord) {
      case 'spawn':
      case 'run':
      case 'start':
        return {
          type: 'spawn',
          args: {
            agent: parts[1] || 'hermes',
            task: parts.slice(2).join(' ') || '',
          },
          raw: text,
        };

      case 'status':
      case 'list':
      case 'sessions':
        return { type: 'status', args: {}, raw: text };

      case 'terminate':
      case 'kill':
      case 'stop':
        return { type: 'terminate', args: { sessionId: parts[1] || '' }, raw: text };

      case 'pause':
        return { type: 'pause', args: { sessionId: parts[1] || '' }, raw: text };

      case 'resume':
        return { type: 'resume', args: { sessionId: parts[1] || '' }, raw: text };

      case 'skill':
        return {
          type: 'skill',
          args: { skillId: parts[1] || '', context: parts.slice(2).join(' ') },
          raw: text,
        };

      case 'memory':
      case 'remember':
      case 'recall':
        return { type: 'memory', args: { query: parts.slice(1).join(' ') }, raw: text };

      case 'help':
      case '?':
        return { type: 'help', args: {}, raw: text };

      default:
        // If no command recognized, treat the whole message as a spawn task
        return {
          type: 'spawn',
          args: { agent: 'hermes', task: text },
          raw: text,
        };
    }
  }

  /**
   * Execute a parsed command and return the response text.
   */
  private async executeCommand(command: ParsedCommand, message: GatewayMessage): Promise<string> {
    switch (command.type) {
      case 'spawn': {
        if (!command.args.task) {
          return '❓ Please provide a task. Example: `spawn claude-code Fix the login bug`';
        }
        const session = await this.sessionManager.createSession({
          agentId: command.args.agent,
          task: command.args.task,
          name: `gateway-${message.platform}-${Date.now()}`,
        });
        return `🚀 Session spawned!\n` +
          `• ID: \`${session.id}\`\n` +
          `• Agent: ${session.agentId}\n` +
          `• Task: ${command.args.task}\n` +
          `I'll notify you when it completes.`;
      }

      case 'status': {
        const sessions = this.sessionManager.listSessions();
        if (sessions.length === 0) return '📭 No active sessions.';
        return '📋 Active sessions:\n' + sessions.map((s) =>
          `• [${s.status}] \`${s.id}\` — ${s.agentId}: ${s.task?.slice(0, 50) ?? 'no task'}`
        ).join('\n');
      }

      case 'terminate': {
        if (!command.args.sessionId) return '❓ Please provide a session ID.';
        await this.sessionManager.terminateSession(command.args.sessionId);
        return `✅ Session \`${command.args.sessionId}\` terminated.`;
      }

      case 'pause': {
        if (!command.args.sessionId) return '❓ Please provide a session ID.';
        await this.sessionManager.pauseSession(command.args.sessionId);
        return `⏸️ Session \`${command.args.sessionId}\` paused.`;
      }

      case 'resume': {
        if (!command.args.sessionId) return '❓ Please provide a session ID.';
        await this.sessionManager.resumeSession(command.args.sessionId);
        return `▶️ Session \`${command.args.sessionId}\` resumed.`;
      }

      case 'skill': {
        if (!command.args.skillId) {
          const skills = this.skillManager.listSkills();
          return '🧠 Available skills:\n' + skills.map((s) =>
            `• \`${s.id}\` — ${s.name}`
          ).join('\n');
        }
        const result = await this.skillManager.executeSkill(command.args.skillId, {
          task: command.args.context,
        });
        return result.success
          ? `✅ Skill executed: ${result.summary}`
          : `❌ Skill failed: ${result.summary}`;
      }

      case 'memory': {
        if (!command.args.query) return '❓ Please provide a search query.';
        return `🔍 Memory search for "${command.args.query}" — (memory engine integration)`;
      }

      case 'help':
        return [
          '🤖 *Hermes Squad Commands:*',
          '',
          '`spawn [agent] [task]` — Start a new agent session',
          '`status` — List all active sessions',
          '`terminate [id]` — Stop a session',
          '`pause [id]` — Pause a session',
          '`resume [id]` — Resume a paused session',
          '`skill [id] [context]` — Execute a skill',
          '`memory [query]` — Search cross-session memory',
          '`help` — Show this message',
          '',
          '*Agents:* claude-code, kiro, codex, gemini, hermes, aider',
          '',
          'Or just send a message and I\'ll treat it as a task! 🚀',
        ].join('\n');

      default:
        return '❓ Unknown command. Type `help` for available commands.';
    }
  }

  // ─── Notifications ────────────────────────────────────────────────────────

  /**
   * Set up event forwarding from the event bus to messaging platforms.
   * Sends notifications when sessions complete, skills are learned, etc.
   */
  private setupEventForwarding(): void {
    this.bus.on('session:terminated', async (sessionId) => {
      const session = this.sessionManager.getSession(sessionId);
      if (session) {
        await this.broadcastNotification(
          `${session.status === 'completed' ? '✅' : '❌'} Session completed: ` +
          `\`${sessionId}\` (${session.agentId}) — ${session.task?.slice(0, 60) ?? 'done'}`
        );
      }
    });

    this.bus.on('skill:learned', async (skillId) => {
      await this.broadcastNotification(`🧠 New skill learned: \`${skillId}\``);
    });
  }

  /**
   * Send a reply to a message (threaded if the platform supports it).
   */
  private async sendReply(originalMessage: GatewayMessage, text: string): Promise<void> {
    const adapter = this.adapters.get(originalMessage.platform);
    if (!adapter) return;

    await adapter.send({
      channelId: originalMessage.channelId,
      text,
      threadId: originalMessage.threadId ?? originalMessage.messageId,
    });
  }

  /**
   * Broadcast a notification to all configured notification channels.
   */
  private async broadcastNotification(text: string): Promise<void> {
    for (const [platform, channels] of this.notificationChannels) {
      const adapter = this.adapters.get(platform);
      if (!adapter?.isConnected()) continue;

      for (const channelId of channels) {
        try {
          await adapter.send({ channelId, text });
        } catch (error) {
          this.logger.warn({ platform, channelId, error }, 'Failed to send notification');
        }
      }
    }
  }

  // ─── Adapter Initialization ───────────────────────────────────────────────

  /**
   * Initialize platform adapters based on available configuration.
   * Only creates adapters for platforms that have valid tokens.
   */
  private async initializeAdapters(): Promise<void> {
    // Slack adapter (if configured)
    if (process.env.HERMES_SQUAD_SLACK_TOKEN) {
      const slackAdapter = await this.createSlackAdapter();
      if (slackAdapter) {
        this.adapters.set('slack', slackAdapter);
        slackAdapter.onMessage((msg) => this.handleMessage(msg));
        await slackAdapter.connect();
      }
    }

    // Discord adapter (if configured)
    if (process.env.HERMES_SQUAD_DISCORD_TOKEN) {
      const discordAdapter = await this.createDiscordAdapter();
      if (discordAdapter) {
        this.adapters.set('discord', discordAdapter);
        discordAdapter.onMessage((msg) => this.handleMessage(msg));
        await discordAdapter.connect();
      }
    }

    // Telegram adapter (if configured)
    if (process.env.HERMES_SQUAD_TELEGRAM_TOKEN) {
      const telegramAdapter = await this.createTelegramAdapter();
      if (telegramAdapter) {
        this.adapters.set('telegram', telegramAdapter);
        telegramAdapter.onMessage((msg) => this.handleMessage(msg));
        await telegramAdapter.connect();
      }
    }
  }

  /**
   * Create a Slack adapter using Bolt.
   * Returns null if the token is invalid or connection fails.
   */
  private async createSlackAdapter(): Promise<GatewayAdapter | null> {
    // Placeholder — full implementation would use @slack/bolt
    this.logger.info('Slack adapter configured (placeholder)');
    return null;
  }

  /**
   * Create a Discord adapter using discord.js.
   */
  private async createDiscordAdapter(): Promise<GatewayAdapter | null> {
    // Placeholder — full implementation would use discord.js
    this.logger.info('Discord adapter configured (placeholder)');
    return null;
  }

  /**
   * Create a Telegram adapter using telegraf.
   */
  private async createTelegramAdapter(): Promise<GatewayAdapter | null> {
    // Placeholder — full implementation would use telegraf
    this.logger.info('Telegram adapter configured (placeholder)');
    return null;
  }
}
