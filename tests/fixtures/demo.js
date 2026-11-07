const context = document.getElementById('code').getContext('2d');
context.fillStyle = '#fff'; context.fillRect(0, 0, 800, 180);
context.fillStyle = '#14342b'; context.font = 'bold 76px Arial'; context.fillText('572948', 45, 118);
const counts = { input: 0, change: 0, submit: 0 };
const update = () => { document.getElementById('events').textContent = `Input events: ${counts.input}; change events: ${counts.change}; submissions: ${counts.submit}`; };
for (const type of ['input', 'change']) document.getElementById('answer').addEventListener(type, () => { counts[type]++; update(); });
document.querySelector('form').addEventListener('submit', (event) => { event.preventDefault(); counts.submit++; update(); });
