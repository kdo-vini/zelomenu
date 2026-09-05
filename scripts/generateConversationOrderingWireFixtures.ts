import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildWireFixtureSnapshots } from '../server/conversationOrderingWireFixtures.js';
import {
  ACCEPTED_COMMAND_BODIES,
  ERROR_CATALOG,
  REJECTED_COMMAND_BODIES,
  REQUIREMENT_TYPE_CATALOG,
} from '../server/conversationOrderingWireContract.js';
import { parseInternalOrderingCommand } from '../server/internalOrdering.js';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://wire-fixtures.generate.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'generate-service-role-key';

const DIR = path.resolve(process.cwd(), 'docs', 'contracts', 'conversation-ordering-wire', 'v1');

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function main() {
  await fs.mkdir(DIR, { recursive: true });

  const snapshots = await buildWireFixtureSnapshots();
  for (const [filename, value] of Object.entries(snapshots)) {
    await fs.writeFile(path.join(DIR, filename), stableJson(value));
  }

  await fs.writeFile(path.join(DIR, 'requirement-types.json'), stableJson(REQUIREMENT_TYPE_CATALOG));
  await fs.writeFile(path.join(DIR, 'errors.json'), stableJson(ERROR_CATALOG));

  const accepted = ACCEPTED_COMMAND_BODIES.map(({ name, body }) => {
    const parsed = parseInternalOrderingCommand(body);
    if (!parsed.ok) throw new Error(`accepted body rejected: ${name}: ${parsed.message}`);
    return { name, body };
  });
  await fs.writeFile(path.join(DIR, 'commands.accepted.json'), stableJson(accepted));

  const rejected = REJECTED_COMMAND_BODIES.map(({ name, body }) => {
    const parsed = parseInternalOrderingCommand(body);
    if (parsed.ok) throw new Error(`rejected body accepted: ${name}`);
    return { name, body, expectedError: { error: 'COMANDO_INVALIDO', message: parsed.message } };
  });
  await fs.writeFile(path.join(DIR, 'commands.rejected.json'), stableJson(rejected));

  console.log('wrote fixtures to', DIR);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
