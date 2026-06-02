const fs = require('fs');

const playground = fs.readFileSync('playground.js', 'utf-8');
const lines = playground.split('\n');

const parserCode = lines.slice(0, 1080).join('\n');

const workerCode = `
self.addEventListener('message', function(e) {
  const data = e.data;
  
  if (data.type === 'compile') {
    try {
      const result = compiler.compile(data.content, data.lang, data.name);
      self.postMessage({
        id: data.id,
        type: 'success',
        result: { text: result.text }
      });
    } catch (err) {
      self.postMessage({
        id: data.id,
        type: 'error',
        error: err.toString()
      });
    }
  }
});
`;

fs.writeFileSync('compiler_worker.js', parserCode + '\n' + workerCode, 'utf-8');
console.log('compiler_worker.js created with ID support.');
