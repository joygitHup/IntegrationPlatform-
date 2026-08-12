import { seedSystem } from '../src/server/seed';

async function main() {
  try {
    const result = await seedSystem();
    console.log('Seed result:', JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  }
}

main();
