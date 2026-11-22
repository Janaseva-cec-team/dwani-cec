// Run locally after creating a normal citizen account:
// node scripts/promote-admin.js user@example.com
const fs = require('fs');
const path = require('path');

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
  console.error('Usage: node scripts/promote-admin.js valid-user@example.com');
  process.exit(1);
}

const file = path.join(__dirname, '..', 'data.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const user = (data.users || []).find(item => String(item.email).toLowerCase() === email);
if (!user) {
  console.error('No account found. Register the account first, then run this command.');
  process.exit(1);
}
user.role = 'admin';
user.title = user.title || 'Dhwani Administrator';
const temp = `${file}.${process.pid}.tmp`;
fs.writeFileSync(temp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
fs.renameSync(temp, file);
console.log(`Administrator role granted to ${email}. Keep this machine and account secure.`);
