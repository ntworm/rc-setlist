import dgram from 'node:dgram';

// OSC message for "/live/song/get/cue_points"
// Address: "/live/song/get/cue_points" (26 chars) + 2 null bytes = 28 bytes
// Type Tag: "," (1 char) + 3 null bytes = 4 bytes
// Total: 32 bytes
const address = '/live/song/get/cue_points';
const addressBuffer = Buffer.alloc(28);
addressBuffer.write(address, 'ascii');

const typeTagBuffer = Buffer.alloc(4);
typeTagBuffer.write(',', 'ascii'); // comma and nulls

const oscQueryMessage = Buffer.concat([addressBuffer, typeTagBuffer]);

const client = dgram.createSocket('udp4');
const server = dgram.createSocket('udp4');

console.log('Iniciando teste de fumaça OSC...');
console.log('Certifique-se de que o Ableton Live está aberto e com o "AbletonOSC" ativado em Preferences > Link/Tempo/MIDI.');

server.on('message', (msg) => {
  console.log('\n========================================');
  console.log('SUCCESS: Resposta OSC recebida do Ableton!');
  console.log('========================================');
  console.log('Raw Buffer (Hex):', msg.toString('hex'));
  console.log('Raw Buffer (ASCII):', msg.toString('ascii').replace(/\0/g, '.'));
  console.log('========================================\n');
  client.close();
  server.close();
  process.exit(0);
});

server.on('error', (err) => {
  console.error('Erro no servidor UDP:', err);
  client.close();
  server.close();
  process.exit(1);
});

// Escuta na porta de resposta (11001)
server.bind(11001, () => {
  console.log('Escutando respostas na porta 11001...');
  
  // Envia para o Ableton na porta 11000
  client.send(oscQueryMessage, 11000, '127.0.0.1', (err) => {
    if (err) {
      console.error('Erro ao enviar mensagem UDP:', err);
      client.close();
      server.close();
      process.exit(1);
    } else {
      console.log('Mensagem OSC sent to 127.0.0.1:11000 successfully.');
      console.log('Aguardando resposta do Ableton (pressione Ctrl+C para cancelar)...');
    }
  });
});

// Timeout de 10 segundos
setTimeout(() => {
  console.log('\nTimeout: Nenhuma resposta recebida do Ableton Live em 10 segundos.');
  console.log('Verifique se o script AbletonOSC está instalado e ativo.');
  client.close();
  server.close();
  process.exit(0);
}, 10000);
