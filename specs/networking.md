# Networking Specification

**File**: `docker/init-firewall.sh`
**Purpose**: Network isolation via iptables whitelist to prevent unauthorized API calls and data exfiltration

## Security Model

```
┌─────────────────────────────────────────────────────────────────┐
│                    Container Network                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  OUTBOUND TRAFFIC                                               │
│  ────────────────                                               │
│                                                                  │
│  ✓ ALLOWED (whitelist)          ✗ BLOCKED (default)            │
│  ├─ api.anthropic.com           ├─ example.com                  │
│  ├─ github.com                  ├─ malicious-api.io             │
│  ├─ api.github.com              ├─ webhook.attacker.com         │
│  ├─ registry.npmjs.org          └─ *                            │
│  ├─ sentry.io                                                    │
│  └─ statsig.anthropic.com                                       │
│                                                                  │
│  DNS: Allowed (required for domain resolution)                  │
│  SSH: Allowed (port 22, for git operations)                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Whitelisted Domains

| Domain | Purpose |
|--------|---------|
| `api.anthropic.com` | Claude API calls |
| `github.com` | Git operations (HTTPS) |
| `api.github.com` | GitHub API |
| `*.githubusercontent.com` | GitHub raw content |
| `registry.npmjs.org` | npm package downloads |
| `sentry.io` | Error telemetry |
| `statsig.anthropic.com` | Feature flags |
| `statsig.com` | Feature flag service |

## Implementation

### Firewall Initialization Flow

```bash
#!/bin/bash
# docker/init-firewall.sh

# 1. Flush existing rules
iptables -F
iptables -X
ipset destroy allowed-domains 2>/dev/null || true

# 2. Create ipset for CIDR ranges
ipset create allowed-domains hash:net

# 3. Fetch and add GitHub IP ranges
gh_meta=$(curl -s https://api.github.com/meta)
echo "$gh_meta" | jq -r '(.web + .api + .git + .packages)[]' | \
  aggregate -q | while read cidr; do
    ipset add allowed-domains "$cidr"
  done

# 4. Resolve and add other domains
for domain in api.anthropic.com registry.npmjs.org sentry.io statsig.anthropic.com statsig.com; do
  dig +short A "$domain" | grep -E '^[0-9]+\.' | while read ip; do
    ipset add allowed-domains "$ip/32"
  done
done

# 5. Set default policies
iptables -P INPUT DROP
iptables -P OUTPUT DROP
iptables -P FORWARD DROP

# 6. Allow loopback
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# 7. Allow established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# 8. Allow DNS (UDP 53)
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A INPUT -p udp --sport 53 -j ACCEPT

# 9. Allow SSH (TCP 22) for git
iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT

# 10. Allow whitelisted destinations
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT

# 11. Reject everything else
iptables -A OUTPUT -j REJECT --reject-with icmp-port-unreachable

echo "Ralph Firewall Ready"
```

### GitHub IP Aggregation

GitHub publishes IP ranges at `https://api.github.com/meta`. The `aggregate` tool combines overlapping CIDR ranges for efficiency:

```bash
# Raw ranges (verbose)
192.30.252.0/22
192.30.252.0/24
192.30.253.0/24

# After aggregation
192.30.252.0/22
```

## Verification

### Test Blocked Traffic
```bash
# Should FAIL (connection refused)
curl https://example.com
curl https://webhook.site/test
curl https://httpbin.org/post
```

### Test Allowed Traffic
```bash
# Should SUCCEED
curl https://api.anthropic.com
curl https://api.github.com
curl https://registry.npmjs.org
```

### Debug Commands
```bash
# View current rules
iptables -L -v -n

# View ipset contents
ipset list allowed-domains

# Test specific IP
iptables -C OUTPUT -d 140.82.112.3 -j ACCEPT
```

## Why Network Isolation?

### Security
- Prevents malicious npm packages from phoning home
- Blocks data exfiltration to attacker-controlled servers
- Limits blast radius if Claude executes unsafe code

### Cost Control
- Prevents unauthorized API calls to paid services
- Blocks crypto mining or other resource abuse
- Ensures only intended services are accessed

### Auditability
- All allowed destinations are explicitly listed
- Easy to review and modify whitelist
- Clear security boundary

## Troubleshooting

### "Connection refused" for allowed domain
```bash
# Check if domain is in ipset
ipset test allowed-domains $(dig +short A api.anthropic.com | head -1)

# Re-resolve if IP changed
dig +short A api.anthropic.com | while read ip; do
  ipset add allowed-domains "$ip/32" 2>/dev/null || true
done
```

### DNS resolution failing
```bash
# Check DNS rules
iptables -L OUTPUT -v -n | grep "udp dpt:53"

# Test DNS directly
dig api.anthropic.com @8.8.8.8
```

### SSH/Git operations failing
```bash
# Check SSH rule
iptables -L OUTPUT -v -n | grep "tcp dpt:22"

# Test SSH connectivity
ssh -T git@github.com
```

## Container Capability Requirements

The firewall requires `CAP_NET_ADMIN` capability:

```bash
docker create --cap-add=NET_ADMIN ...
```

Without this capability, iptables commands will fail with "Permission denied".

## Startup Sequence

1. Container starts as root
2. `entrypoint.sh` calls `init-firewall.sh`
3. Firewall rules are applied
4. "Ralph Firewall Ready" is printed (orchestrator waits for this)
5. Privileges are dropped to `node` user
6. Claude runs with network restrictions in place

## Extending the Whitelist

To add a new domain:

```bash
# In init-firewall.sh, add to the resolution loop:
for domain in api.anthropic.com registry.npmjs.org NEW_DOMAIN.com; do
  dig +short A "$domain" | grep -E '^[0-9]+\.' | while read ip; do
    ipset add allowed-domains "$ip/32"
  done
done
```

For services with dynamic IPs, consider:
1. Using the service's published IP ranges (like GitHub)
2. Resolving at startup (current approach)
3. Allowing broader CIDR ranges if necessary
