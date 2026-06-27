import { ChatService } from './src/services/chat.service';
import { SUPPORTED_MODELS } from './src/utils/constant';
import * as fs from 'fs';
import * as path from 'path';

// Load Env variables from .env.local
const envPath = path.resolve(__dirname, '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  });
}

async function main() {
  const chatService = new ChatService();
  const history = [
    { role: 'user', content: 'recommend me some anime' },
    { role: 'model', content: 'Sure, I recommend Fairy Tail and Granblue Fantasy.' }
  ];

  console.log("Routing intent...");
  const intent = await chatService.routeIntent("are there any other fantasy shows like them?", history, 'anime', SUPPORTED_MODELS.QWEN_7B);
  console.log("Intent:", intent);
  
  console.log("Streaming recommendation...");
  const stream = await chatService.streamRecommendation("are there any other fantasy shows like them?", history, SUPPORTED_MODELS.QWEN_7B, 'anime');
  for await (const chunk of stream) {
    process.stdout.write(chunk);
  }
  console.log("\nDone!");
}
main().catch(console.error);
