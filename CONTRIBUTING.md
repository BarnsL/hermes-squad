# Contributing to Hermes Squad

First off, thank you for considering contributing to Hermes Squad! 🎉

This document provides guidelines and information for contributors. Following these guidelines helps communicate that you respect the time of the developers managing this project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)
- [Testing Requirements](#testing-requirements)
- [Commit Messages](#commit-messages)
- [Issue Guidelines](#issue-guidelines)
- [Release Process](#release-process)

---

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating, you are expected to uphold this code. Please report unacceptable behavior to [security@hermes-squad.dev](mailto:security@hermes-squad.dev).

---

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally
3. **Create a branch** for your changes
4. **Make** your changes
5. **Test** your changes
6. **Push** to your fork
7. **Open a Pull Request**

### What Can I Contribute?

- 🐛 Bug fixes
- ✨ New features
- 📝 Documentation improvements
- 🧪 Test coverage
- 🤖 New agent adapters
- 🔌 New integrations (ACP/MCP)
- 🎨 TUI improvements
- 🌐 Translations

---

## Development Setup

### Prerequisites

- **Node.js** >= 20.x
- **pnpm** >= 9.x
- **Go** >= 1.22 (for session manager)
- **tmux** >= 3.3
- **git** >= 2.40

### Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/hermes-squad.git
cd hermes-squad

# Install dependencies
make dev-setup

# Verify everything works
make test

# Start development mode
make dev
```

### Project Structure

```
src/
├── core/           # Core orchestration — start here
├── agents/         # Agent adapters (add new agents here)
├── intelligence/   # Self-improving ML layer
├── session/        # Tmux session management
├── git/            # Git worktree operations
├── tui/            # Terminal UI components
├── integrations/   # ACP/MCP connectors
└── cli/            # CLI entry point and commands
```

---

## Making Changes

### Branch Naming

Use descriptive branch names with a prefix:

```
feat/agent-routing-improvements
fix/tmux-session-cleanup
docs/acp-integration-guide
test/intelligence-layer-coverage
refactor/session-manager-types
```

### Development Workflow

```bash
# Create a feature branch
git checkout -b feat/my-feature

# Make changes and test
make test
make lint

# Run the full CI check locally
make ci

# Commit with conventional commit message
git commit -m "feat(agents): add support for custom agent binaries"
```

---

## Pull Request Process

### Before Submitting

- [ ] All tests pass (`make test`)
- [ ] Linting passes (`make lint`)
- [ ] Type checking passes (`make typecheck`)
- [ ] New code has test coverage ≥ 80%
- [ ] Documentation is updated if needed
- [ ] CHANGELOG.md is updated (for user-facing changes)
- [ ] No unrelated changes are included

### PR Template

When opening a PR, please include:

```markdown
## Summary
Brief description of changes.

## Motivation
Why is this change needed?

## Changes
- Change 1
- Change 2

## Testing
How were these changes tested?

## Screenshots (if applicable)
```

### Review Process

1. **Automated checks** — CI must pass (build, test, lint, typecheck)
2. **Code review** — At least one maintainer approval required
3. **Discussion** — Address all review comments
4. **Merge** — Maintainer will squash-merge once approved

### PR Size Guidelines

- **Small** (< 200 lines): Quick review, usually merged same day
- **Medium** (200-500 lines): Standard review, 1-2 day turnaround
- **Large** (500+ lines): Consider splitting into smaller PRs

---

## Code Style

### TypeScript

We use **ESLint** + **Prettier** with a strict configuration:

```bash
# Auto-fix issues
make lint-fix

# Check only
make lint
```

Key rules:

- **Strict TypeScript** — No `any` types, explicit return types on exported functions
- **Functional style** — Prefer `const`, immutable data, pure functions where possible
- **Named exports** — No default exports
- **Barrel files** — Use `index.ts` for public API, internal modules stay private

```typescript
// ✅ Good
export const createAgent = (config: AgentConfig): Agent => {
  // ...
};

// ❌ Bad
export default function(config: any) {
  // ...
}
```

### Go (Session Manager)

- Follow standard `gofmt` formatting
- Use `golangci-lint` with our `.golangci.yml` config
- Error wrapping with `fmt.Errorf("context: %w", err)`

### File Organization

```typescript
// 1. External imports
import { spawn } from "node:child_process";

// 2. Internal imports
import { AgentConfig } from "../types";
import { logger } from "../utils/logger";

// 3. Types/interfaces
interface SessionOptions {
  // ...
}

// 4. Constants
const MAX_RETRIES = 3;

// 5. Implementation
export const createSession = (opts: SessionOptions): Session => {
  // ...
};
```

---

## Testing Requirements

### Coverage Thresholds

| Area | Minimum Coverage |
|:-----|:----------------:|
| Core | 90% |
| Agents | 80% |
| Intelligence | 85% |
| Integrations | 75% |
| CLI | 70% |
| Overall | 80% |

### Test Structure

```bash
tests/
├── unit/           # Fast, isolated unit tests
├── integration/    # Tests with external dependencies
├── e2e/            # End-to-end workflow tests
└── fixtures/       # Test data and mocks
```

### Writing Tests

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createAgent } from "../src/agents/factory";

describe("AgentFactory", () => {
  describe("createAgent", () => {
    it("should create a Claude Code agent with default config", () => {
      const agent = createAgent({ name: "claude-code" });
      
      expect(agent.name).toBe("claude-code");
      expect(agent.status).toBe("idle");
    });

    it("should throw on invalid agent name", () => {
      expect(() => createAgent({ name: "" })).toThrow(
        "Agent name is required"
      );
    });
  });
});
```

### Running Tests

```bash
# All tests
make test

# Unit tests only
make test-unit

# Integration tests
make test-integration

# E2E tests (requires tmux)
make test-e2e

# With coverage report
make test-coverage
```

---

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

| Type | Description |
|:-----|:------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Code style (no logic change) |
| `refactor` | Code change (no feature/fix) |
| `perf` | Performance improvement |
| `test` | Adding/fixing tests |
| `build` | Build system changes |
| `ci` | CI configuration |
| `chore` | Other changes |

### Examples

```
feat(agents): add Amp agent adapter
fix(session): prevent tmux session leak on crash
docs(readme): update installation instructions
test(intelligence): add skill graph routing tests
refactor(core): extract task queue into separate module
```

---

## Issue Guidelines

### Bug Reports

Include:
- Hermes Squad version (`hermes-squad --version`)
- OS and architecture
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs (use `hermes-squad --verbose`)

### Feature Requests

Include:
- Use case description
- Proposed solution
- Alternatives considered
- Willingness to implement

---

## Release Process

Releases are automated via CI when a version tag is pushed:

```bash
# Maintainers only
git tag v0.2.0
git push origin v0.2.0
```

The CI pipeline will:
1. Run full test suite
2. Build binaries for all platforms
3. Create GitHub release
4. Publish to Homebrew tap
5. Update documentation site

---

## Questions?

- 💬 [Discord](https://discord.gg/hermes-squad) — For quick questions
- 🐛 [GitHub Issues](https://github.com/barnsl/hermes-squad/issues) — For bugs and features
- 📧 [Email](mailto:hello@hermes-squad.dev) — For sensitive matters

Thank you for helping make Hermes Squad better! 🚀
