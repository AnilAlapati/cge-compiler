import { ArchitectureMapGeneratorPhase2 } from '../src/architecture_map_generator_phase2';
import * as path from 'path';

async function main() {
    const generator = new ArchitectureMapGeneratorPhase2();
    const rootDir = path.join(__dirname, '..', 'benchmarks_real', 'nestjs-real');
    const sourceDir = path.join(rootDir, 'source');
    await generator.generate(sourceDir, 'GENERATED_ARCHITECTURE.md');
    console.log("Done generating architecture map!");
}

main().catch(console.error);
