// Cliente SMTP mínimo para enviar desde Gmail (u otro proveedor) con los sockets de Cloudflare.
// Gmail: smtp.gmail.com:465 (TLS) + «contraseña de aplicación» de Google.
import { connect } from 'cloudflare:sockets';

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = s => {
  const bytes = typeof s === 'string' ? enc.encode(s) : s;
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const wrap = s => s.replace(/.{1,76}/g, '$&\r\n');
const encodeWord = s => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`;
const addr = (name, email) => name ? `"${encodeWord(name).replace(/"/g, '')}" <${email}>` : `<${email}>`;

export async function smtpSend({ host = 'smtp.gmail.com', port = 465, secure = 'on', user, pass, fromName, to, replyTo, subject, html, text }) {
  const socket = connect({ hostname: host, port }, { secureTransport: secure, allowHalfOpen: false });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  let buf = '';

  // Lee una respuesta completa (multilínea «250-…» hasta «250 …»)
  async function reply() {
    for (;;) {
      const lines = buf.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) {
          const out = lines.slice(0, i + 1);
          buf = lines.slice(i + 1).join('\r\n');
          return { code: Number(lines[i].slice(0, 3)), text: out.join('\n') };
        }
      }
      let timer;
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('El servidor de correo no responde (tiempo agotado)')), 15000); }),
      ]).finally(() => clearTimeout(timer));
      if (done) throw new Error('El servidor de correo cerró la conexión');
      buf += dec.decode(value, { stream: true });
    }
  }
  async function cmd(line, expect) {
    await writer.write(enc.encode(line + '\r\n'));
    const r = await reply();
    if (expect && !expect.includes(r.code)) throw new Error(`SMTP ${r.code}: ${r.text.replace(/\n/g, ' ').slice(0, 200)}`);
    return r;
  }

  try {
    const hello = await reply();
    if (hello.code !== 220) throw new Error('SMTP no disponible: ' + hello.text);
    await cmd('EHLO terracota-reservas', [250]);
    await cmd('AUTH PLAIN ' + b64(`\0${user}\0${pass}`), [235]);
    await cmd(`MAIL FROM:<${user}>`, [250]);
    for (const r of [].concat(to)) await cmd(`RCPT TO:<${r}>`, [250, 251]);
    await cmd('DATA', [354]);

    const boundary = 'ts-' + crypto.randomUUID();
    const headers = [
      `From: ${addr(fromName, user)}`,
      `To: ${[].concat(to).map(t => `<${t}>`).join(', ')}`,
      replyTo ? `Reply-To: <${replyTo}>` : null,
      `Subject: ${encodeWord(subject)}`,
      `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
      `Message-ID: <${crypto.randomUUID()}@${user.split('@')[1] || 'terracota'}>`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ].filter(Boolean);
    const plain = text || html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    const body = [
      `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(b64(plain)),
      `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(b64(html)),
      `--${boundary}--`, '',
    ].join('\r\n');
    await writer.write(enc.encode(headers.join('\r\n') + '\r\n\r\n' + body + '\r\n'));
    await cmd('.', [250]);
    await cmd('QUIT').catch(() => {});
    return { ok: true };
  } finally {
    try { await writer.close(); } catch {}
    try { socket.close(); } catch {}
  }
}
