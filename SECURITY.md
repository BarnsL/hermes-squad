# Security Policy

## Supported Versions

| Version | Supported          |
|:--------|:------------------:|
| 0.1.x   | ✅ Active          |
| < 0.1   | ❌ Not supported   |

We provide security patches for the latest minor release. Users are encouraged to stay on the latest version.

---

## Reporting a Vulnerability

**⚠️ Please do NOT report security vulnerabilities through public GitHub issues.**

### Responsible Disclosure

If you discover a security vulnerability in Hermes Squad, please report it responsibly:

1. **Email**: Send details to [security@hermes-squad.dev](mailto:security@hermes-squad.dev)
2. **Encrypt**: Use our [PGP key](https://hermes-squad.dev/.well-known/pgp-key.txt) for sensitive information
3. **Include**:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact assessment
   - Suggested fix (if any)

### Response Timeline

| Stage | Timeline |
|:------|:---------|
| Acknowledgment | Within 48 hours |
| Initial Assessment | Within 5 business days |
| Fix Development | Within 14 business days (critical) |
| Public Disclosure | After fix is released + 30 days |

### What to Expect

- A confirmation email acknowledging your report
- Regular updates on the status of the fix
- Credit in the security advisory (unless you prefer anonymity)
- A CVE identifier if applicable

---

## Security Considerations

### Agent Execution

Hermes Squad executes AI agents that can run arbitrary code. Key security measures:

- **Sandboxed Sessions**: Each agent runs in an isolated tmux session
- **Git Worktree Isolation**: Agents cannot modify the main branch directly
- **Permission Scoping**: Configurable file system and network access per agent
- **Audit Logging**: All agent actions are logged for review

### Configuration Security

- **Secrets**: Never store API keys in config files. Use environment variables or system keychain.
- **Permissions**: Config files should be readable only by the owner (`chmod 600`)
- **Network**: ACP/MCP endpoints bind to localhost by default

### Recommended Practices

```toml
# ✅ Good: Use environment variables for secrets
[agents.claude-code]
api_key_env = "ANTHROPIC_API_KEY"

# ❌ Bad: Hardcoded secrets
[agents.claude-code]
api_key = "sk-ant-..."
```

### Network Security

- ACP servers bind to `127.0.0.1` by default
- MCP server supports TLS when exposed externally
- All inter-agent communication is local-only unless explicitly configured

---

## Known Security Limitations

1. **Agent Trust**: AI agents can execute arbitrary shell commands within their session. Only use agents you trust.
2. **Tmux Shared Access**: Any user with access to the tmux socket can attach to agent sessions.
3. **Git Credentials**: Agents inherit git credentials from the environment.

---

## Security Updates

Security advisories are published via:

- [GitHub Security Advisories](https://github.com/barnsl/hermes-squad/security/advisories)
- Our mailing list (subscribe at [hermes-squad.dev/security](https://hermes-squad.dev/security))
- Discord announcements channel

---

## Hall of Fame

We gratefully acknowledge security researchers who have responsibly disclosed vulnerabilities:

_No reports yet — be the first!_

---

## Contact

- **Security Email**: [security@hermes-squad.dev](mailto:security@hermes-squad.dev)
- **PGP Fingerprint**: `XXXX XXXX XXXX XXXX XXXX  XXXX XXXX XXXX XXXX XXXX`
