import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = 3000;
const baseDir = 'D:\\Users\\Public\\Documents\\NNETE DOCUMENTS\\POINT OF SALE SYSTEM';

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json'
};

const server = http.createServer((req, res) => {
  let filePath = path.join(baseDir, req.url === '/' ? 'login.html' : req.url);
  
  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'text/plain';
  
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('404 Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Simple server running on http://localhost:${PORT}`);
});