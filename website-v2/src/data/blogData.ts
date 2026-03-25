export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  date: string;
  author: string;
  excerpt: string;
  content: string;
  tags: string[];
}

export const blogPosts: BlogPost[] = [
  {
    id: 'formal-verification-anchor-v3',
    slug: 'formal-verification-anchor-protocol',
    title: 'Math vs Chaos: How We Proved the Anchor Protocol Is Indestructible',
    date: '2026-03-12',
    author: 'Port Daddy Engineering',
    excerpt: 'We used ProVerif to mathematically prove the secrecy and authentication properties of our new multi-hop identity protocol. Here is how we did it.',
    tags: ['Security', 'Formal Methods', 'ProVerif', 'Anchor Protocol'],
    content: `
# Proving the Anchor Protocol

I've spent way too many late nights staring at my terminal, wondering why my agent swarm suddenly turned into a bunch of zombies fighting over port 3000. It's usually a ghost process—some dead agent that didn't actually die, still squatting on a resource and wrecking the whole workflow.

When we're building autonomous swarms that move fast, we can't just hope the identity logic works. We have to know. Not unit test know, but mathematical proof know. 

That is why we built the Anchor Protocol and ran it through the ProVerif prover. We basically wanted to prove that no matter how chaotic the environment gets, the protocol itself is solid.

## The Handshake: Establishing Trust

Anchor manages your Harbor Card—that little piece of cryptographically signed ID that tells other agents what you're allowed to do. 

We modeled this using symbolic analysis. Instead of looking at individual bits, we look at the pure logic. We asked the prover: Can an attacker ever trick a Harbor into accepting a card that the Daemon didn't issue?

ProVerif explored every possible path, including attackers sniffing the network and trying to replay old tokens. The result? It's impossible. Trust is anchored.

\`\`\`mermaid
sequenceDiagram
    autonumber
    participant A as Agent
    participant D as Daemon
    participant H as Harbor
    
    A->>D: Give me a card
    D->>D: Sign with Master Key
    D->>A: Here's your card (Ed25519)
    
    A->>H: I'm here
    H->>H: Pin Alg: EdDSA
    H->>H: Check Signature
    H->>A: Access Granted
\`\`\`

## Killing the None Attack

You might have heard of JWT algorithm confusion. It's when a verifier is tricked into skipping the signature check because the attacker says the algorithm is none. 

We verified that our implementation is immune to this. The verifier doesn't care what the token says it is. It forces an Ed25519 check every single time. It's like a bouncer who doesn't care if your ID says you're the owner; they're checking the holographic seal no matter what.

\`\`\`proverif
(* The SECURE Harbor logic we proved *)
let SecureHarbor(k: key) =
  in(c, (alg_header: alg_type, msg: bitstring, signature: bitstring));
  if check_ed25519(msg, k, signature) = true then
    event Accepted().
\`\`\`

## Multi-hop Delegation: Passing the Torch

This is the nerdier part of v4. If Agent A spawns Agent B, it can pass a restricted version of its ID without needing to talk to the Daemon. We call this offline attenuation.

The math proves that Agent B can never have more power than Agent A. If Agent A can only read files, it can't give Agent B the power to delete them. Trust flows down, but it never escalates.

## What We Learned

Running these proofs gave us the confidence to ship v3.8.0. We verified three critical layers:
1. **Design Soundness**: The protocol logic is tight.
2. **Memory Safety**: The Rust core doesn't crash or leak.
3. **Side-Channel Mitigation**: Equality checks are constant-time to prevent timing attacks.

If you want to geek out on the actual proof files, they're sitting in the /analyses directory of the repo. Check them out and let's build something indestructible.

---

### Further Reading
* [Official ProVerif Documentation](https://proverif.inria.fr/)
* [RFC 8032: EdDSA signatures](https://tools.ietf.org/html/rfc8032)
* [The Anchor Formal Report](https://github.com/curiositech/port-daddy/blob/main/docs/reports/FORMAL_VERIFICATION_ANCHOR_V3.md)
    `
  }
];
