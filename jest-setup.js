// Jest setup provided by Grafana scaffolding
import './.config/jest-setup';

// The scaffold setup installs Node's worker_threads MessageChannel globally. React's scheduler
// (loaded via @grafana/ui) opens a channel at import time, and its open ports keep Jest from
// exiting after the tests finish. Track every channel and close its ports after each test file.
const openChannels = [];

class ClosableMessageChannel extends global.MessageChannel {
  constructor() {
    super();
    openChannels.push(this);
  }
}

global.MessageChannel = ClosableMessageChannel;

afterAll(() => {
  for (const channel of openChannels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});
