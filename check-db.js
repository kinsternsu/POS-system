import Database from 'better-sqlite3';

const db = new Database('./pos.db');

console.log('=== Products in database ===');
const products = db.prepare('SELECT * FROM products').all();
console.log(products);

console.log('\n=== Products count:', products.length);
console.log('\n=== Active products ===');
const active = db.prepare('SELECT * FROM products WHERE is_active = 1').all();
console.log(active);

db.close();