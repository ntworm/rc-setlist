import dgram from 'node:dgram';

// OSC message for "/live/song/get/tempo"
// Address: "/live/song/get/tempo" (20 chars) + 4 null bytes = 24 bytes
// Type Tag: "," (1 char) + 3 null bytes = 4 bytes
// Total: 28 bytes
const address = '/live/song/get/tempo';
const addressBuffer = Buffer.alloc(24);
addressBuffer.write(address, 'ascii');

const typeTagBuffer = Buffer.alloc(4);
typeTagBuffer.write(',', 'ascii');

const oscQueryMessage = Buffer.concat([addressBuffer, typeTagBuffer]);

const client = dgram.createSocket('udp4');
const server = dgram.createSocket('udp4');

console.log('Consultando o Tempo (BPM) do Ableton Live via OSC...');

server.on('message', (msg) => {
  console.log('\n========================================');
  console.log('SUCCESS: Resposta recebida do Ableton!');
  console.log('========================================');
  
  // O buffer de resposta deve conter:
  // 1. O endereço "/live/song/get/tempo" (terminado em null, alinhado a 4 bytes)
  // 2. Os type tags (ex: ",f" para float, terminado em null)
  // 3. O valor float em 4 bytes (Big Endian)
  
  // Vamos imprimir os dados brutos e tentar decodificar o valor
  console.log('Raw Hex:', msg.toString('hex'));
  
  // Encontra o fim da string de endereço (primeiro null após o início)
  let addrEnd = msg.indexOf(0);
  const respAddr = msg.toString('ascii', 0, addrEnd);
  console.log('OSC Address:', respAddr);
  
  // O cabeçalho OSC (endereço) é alinhado em 4 bytes
  let typeTagStart = Math.ceil((addrEnd + 1) / 4) * 4;
  let typeTagEnd = msg.indexOf(0, typeTagStart);
  const typeTags = msg.toString('ascii', typeTagStart, typeTagEnd);
  console.log('OSC Type Tags:', typeTags);
  
  // O valor do argumento começa após o type tag alinhado a 4 bytes
  let argStart = Math.ceil((typeTagEnd + 1) / 4) * 4;
  
  if (typeTags.includes('f') && msg.length >= argStart + 4) {
    const tempo = msg.readFloatBE(argStart);
    console.log('Parsed Tempo:', tempo.toFixed(2), 'BPM');
  } else if (typeTags.includes('d') && msg.length >= argStart + 8) {
    const tempo = msg.readDoubleBE(argStart);
    console.log('Parsed Tempo:', tempo.toFixed(2), 'BPM');
  } else {
    console.log('Não foi possível ler o float do buffer.');
  }
  
  console.log('========================================\n');
  client.close();
  server.close();
  process.exit(0);
});

server.bind(11001, () => {
  client.send(oscQueryMessage, 11000, '127.0.0.1', (err) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
  });
});

setTimeout(() => {
  console.log('Timeout: Nenhuma resposta de tempo recebida.');
  client.close();
  server.close();
  process.exit(0);
}, 5000);
