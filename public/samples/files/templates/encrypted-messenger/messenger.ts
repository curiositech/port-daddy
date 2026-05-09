/**
 * Port Daddy Template: Encrypted Messenger
 *
 * Demonstrates End-to-End Encryption (E2EE) between agents
 * using Harbor Cards and the Agent Inbox dead-drop system.
 */

import { createClient } from '../../lib/client.js';
import crypto from 'crypto';

async function run() {
  const pd = createClient();
  const agentId = 'agent:messenger:1';

  // 1. Register and get Harbor Card (contains our public key)
  console.log('⚓ Registering agent...');
  await pd.beginSession({
    identity: agentId,
    purpose: 'Secure E2EE communication demo'
  });

  // 2. Mock: Generate an ephemeral E2EE keypair for this session
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  // 3. Update metadata so others can find our E2EE key
  await pd.updateAgentMetadata(agentId, {
    e2ee_public_key: publicKey.export({ type: 'spki', format: 'pem' })
  });

  console.log('📬 Waiting for encrypted messages...');

  // 4. Poll inbox for messages
  setInterval(async () => {
    const { messages } = await pd.getInboxMessages(agentId);
    for (const msg of messages) {
      if (msg.metadata?.encrypted) {
        try {
          const decrypted = crypto.privateDecrypt(
            privateKey,
            Buffer.from(msg.content, 'base64')
          );
          console.log(`🔓 Decrypted message from ${msg.from}:`, decrypted.toString());
        } catch (e) {
          console.error('❌ Failed to decrypt message');
        }
      }
    }
  }, 5000);
}

// In a real app, you'd use a 'send' function like this:
async function sendEncrypted(toAgentId: string, text: string) {
  const pd = createClient();
  const target = await pd.getAgent(toAgentId);
  const targetKey = target.metadata?.e2ee_public_key;

  if (targetKey) {
    const encrypted = crypto.publicEncrypt(
      targetKey,
      Buffer.from(text)
    );
    await pd.sendInboxMessage(toAgentId, encrypted.toString('base64'), {
      metadata: { encrypted: true }
    });
  }
}

run().catch(console.error);
