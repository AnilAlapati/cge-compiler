import * as fs from 'fs';
import * as path from 'path';

const LICENSE_HEADER = `/*
 * Copyright (c) 2026 Acme Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * ==============================================================================
 * Changelog:
 * v1.0.0 - Initial commit by John Doe
 * v1.1.0 - Refactored routing
 * v2.0.0 - Migrated to new architecture
 * ==============================================================================
 */\n\n`;

const DEAD_CODE = `
// function legacyHandler(req, res) {
//    console.log("This is an old handler that we don't use anymore");
//    // We should probably delete this eventually
//    return res.status(500).send("Deprecated");
// }
// 
// const oldConfig = {
//    host: 'legacy.db.internal',
//    port: 5432,
//    user: 'admin'
// };
`;

const JSDOC = `
/**
 * Core component responsible for handling domain logic.
 * Ensures that all invariants are maintained before persisting state.
 * @module DomainHandler
 * @see {@link http://internal.wiki.acme.corp/domain-handler}
 */
`;

function walk(dir: string) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            walk(fullPath);
        } else if (fullPath.endsWith('.ts')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            
            // Add license at top
            content = LICENSE_HEADER + content;
            
            // Add dead code in the middle somewhere
            const lines = content.split('\n');
            const mid = Math.floor(lines.length / 2);
            lines.splice(mid, 0, DEAD_CODE);
            
            // Add some JSDocs to random classes/functions
            let finalContent = lines.join('\n');
            finalContent = finalContent.replace(/export class /g, JSDOC + "export class ");
            finalContent = finalContent.replace(/export function /g, JSDOC + "export function ");
            
            // Add some TODOs
            finalContent += "\n\n// TODO: Fix this module, it has performance issues\n// FIXME: Memory leak detected in v2.0\n";
            
            fs.writeFileSync(fullPath, finalContent);
        }
    }
}

walk(path.join(__dirname, '..', 'benchmarks_real', 'messy-nestjs', 'source'));
console.log("Messified the repo!");
