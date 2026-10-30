// micro:bit steering wheel over Bluetooth (same UART link as the fishing reel). Needs Bluefy on iPhone.
// micro:bit -> game: "s<degrees>" about 25 times a second (+ = turned right)
// game -> micro:bit: "go", "l<lap>", "fin"
const UART = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';

export class MicroBit {
  constructor() {
    this.out = null; this.angle = 0; this.t = -1e9; this.buf = ''; this.queue = []; this.sending = false;
    this.status = ''; this.onChange = () => {};
  }
  get supported() { return !!navigator.bluetooth; }
  // true while angles are arriving (stops steering if the micro:bit goes quiet)
  get active() { return performance.now() - this.t < 1000; }
  async connect() {
    let step = 'picking the micro:bit';
    try {
      // show everything: a micro:bit can call itself "BBC micro:bit", "uBit" or just its 5-letter name
      const dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [UART] });
      dev.addEventListener('gattserverdisconnected', () => { this.out = null; this.set('micro:bit disconnected'); });
      step = 'connecting';
      const server = await dev.gatt.connect();
      step = 'finding the message service';
      const uart = await server.getPrimaryService(UART);
      step = 'starting messages';
      for (const c of await uart.getCharacteristics()) {
        if (c.properties.notify || c.properties.indicate) {
          c.addEventListener('characteristicvaluechanged', e => this.read(new TextDecoder().decode(e.target.value)));
          await c.startNotifications();
        } else if (c.properties.write || c.properties.writeWithoutResponse) this.out = c;
      }
      this.set('micro:bit connected');
    } catch (e) {
      this.set('micro:bit failed while ' + step + ': ' + e.message);
    }
  }
  read(text) {
    this.buf += text;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (line[0] === 's') { const a = parseFloat(line.slice(1)); if (!isNaN(a)) { this.angle = a; this.t = performance.now(); } }
    }
  }
  // one message at a time (Bluetooth gets upset if two writes overlap)
  send(text) {
    if (!this.out) return;
    this.queue.push(text);
    if (this.sending) return;
    this.sending = true;
    (async () => {
      while (this.queue.length && this.out) {
        try { await this.out.writeValue(new TextEncoder().encode(this.queue.shift() + '\n')); } catch (e) { console.warn(e); }
      }
      this.sending = false;
    })();
  }
  set(s) { this.status = s; this.onChange(s); }
}
