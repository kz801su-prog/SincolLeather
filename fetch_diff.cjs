const https = require('https');

https.get('https://api.github.com/repos/kz801su-prog/SincolLeather/commits/384f7304748a78e4280f2561a46f2e6c4965dd5a', {
  headers: {
    'User-Agent': 'Node.js',
    'Accept': 'application/vnd.github.v3.diff'
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log(data));
}).on('error', err => console.error(err));
