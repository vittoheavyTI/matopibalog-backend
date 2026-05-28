const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const os = require('os');

function getNameOrigin(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('rede') || n.includes('wifi') || n.includes('wsd')) return 'WSD (Wi-Fi)';
  if (n.includes('tcp') || n.includes('ip_')) return 'Rede (TCP/IP)';
  return 'Local';
}

function getType(name, driver) {
  const d = ((driver || '') + (name || '')).toLowerCase();
  if (d.includes('thermal') || d.includes('zebra')) return 'termica';
  if (d.includes('fiscal') || d.includes('daruma')) return 'fiscal';
  return 'laser';
}

// Lê nomes das impressoras do registro do Windows (rápido, não trava)
router.get('/todas', async (req, res) => {
  const platform = os.platform();
  if (platform !== 'win32') {
    exec('lpstat -a 2>/dev/null; avahi-browse -rt _ipp._tcp -t 2>/dev/null', { timeout: 10000 }, (err, stdout) => {
      const printers = [];
      if (stdout) stdout.split('\n').forEach(line => { const m = line.match(/(\S+)\s/); if (m) printers.push({ nome: m[1], tipo: 'termica', origem: 'Rede' }); });
      res.json(printers);
    });
    return;
  }

  exec('reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers"', { timeout: 5000 }, (err, stdout) => {
    if (err || !stdout) return res.json([]);
    const printers = [];
    stdout.split('\n').forEach(line => {
      const m = line.match(/Printers\\(.+)$/);
      if (m && m[1]) {
        const name = m[1].trim();
        if (name.includes('Microsoft') || name.includes('OneNote') || name.includes('Fax') || name.includes('PDF') || name.includes('XPS')) return;
        const origem = getNameOrigin(name);
        printers.push({
          nome: name,
          tipo: getType(name, ''),
          ip: origem === 'WSD (Wi-Fi)' ? 'WSD' : origem === 'Rede (TCP/IP)' ? 'TCP/IP' : 'USB',
          fabricante: 'Windows',
          origem,
          instalada: true,
          compartilhada: false,
          porta: ''
        });
      }
    });
    res.json(printers);
  });
});

// Busca por nome — filtra a lista do registro
router.get('/buscar/:nome', async (req, res) => {
  const nome = req.params.nome;
  const platform = os.platform();
  if (platform !== 'win32') {
    exec('lpstat -a 2>/dev/null; avahi-browse -rt _ipp._tcp -t 2>/dev/null | grep -i "' + nome + '"', { timeout: 10000 }, (err, stdout) => {
      if (!stdout) return res.json([]);
      const printers = stdout.split('\n').filter(l => l).map(l => { const m = l.match(/(\S+)\s/); return m ? { nome: m[1], tipo: 'termica', origem: 'Rede', instalada: true } : null; }).filter(Boolean);
      res.json(printers);
    });
    return;
  }

  const filter = nome.replace(/'/g, "''");
  exec('reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers"', { timeout: 5000 }, (err, stdout) => {
    if (err || !stdout) return res.json([]);
    const printers = [];
    stdout.split('\n').forEach(line => {
      const m = line.match(/Printers\\(.+)$/);
      if (m && m[1]) {
        const name = m[1].trim();
        if (!name.toLowerCase().includes(nome.toLowerCase())) return;
        const origem = getNameOrigin(name);
        printers.push({
          nome: name,
          tipo: getType(name, ''),
          ip: origem === 'WSD (Wi-Fi)' ? 'WSD' : origem === 'Rede (TCP/IP)' ? 'TCP/IP' : 'USB',
          fabricante: 'Windows',
          origem,
          instalada: true,
          porta: ''
        });
      }
    });
    res.json(printers);
  });
});

// Testar — apenas verifica se impressora existe no registro
router.post('/testar', async (req, res) => {
  const { nome } = req.body;
  if (!nome) return res.json({ success: false, error: 'Nome da impressora obrigatorio' });
  const n = nome.replace(/'/g, "''");
  exec('reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers\\' + n + '"', { timeout: 5000 }, (err) => {
    if (err) return res.json({ success: false, printer: false, ping: false, testPage: false, error: 'Impressora nao encontrada' });
    // Tenta ping para IPs, mas primeiro verifica se há IP no nome
    const ipMatch = nome.match(/(\d+\.\d+\.\d+\.\d+)/);
    const result = { success: true, printer: true, ping: false, testPage: false };
    if (ipMatch) {
      exec('ping -n 1 ' + ipMatch[1], { timeout: 5000 }, (err2, stdout2) => {
        result.ping = !err2 && stdout2?.includes('TTL=');
        res.json(result);
      });
    } else {
      res.json(result);
    }
  });
});

router.get('/health', (req, res) => {
  res.json({ status: 'ok', platform: os.platform() });
});

module.exports = router;
