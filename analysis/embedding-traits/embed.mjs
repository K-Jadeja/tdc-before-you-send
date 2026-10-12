// Usage: node embed.mjs <facesDir> <outJson>
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AutoModel, AutoProcessor, load_image } from '@huggingface/transformers';

const [facesDir, outJson] = process.argv.slice(2);
const model_id = 'onnx-community/embeddinggemma-2-ONNX';
const t0 = Date.now();
const processor = await AutoProcessor.from_pretrained(model_id);
const model = await AutoModel.from_pretrained(model_id, { device: process.env.DEVICE || 'cpu', dtype: 'q4' });
console.log(`model loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const embed = async (...inputs) => (await model(await processor(...inputs))).sentence_embedding;

const files = readdirSync(facesDir).filter((f) => f.endsWith('.jpg')).sort();
const images = {};
const t1 = Date.now();
for (const file of files) {
  const vec = await embed(null, await load_image(join(facesDir, file)));
  images[file] = Array.from(vec.data);
}
console.log(`${files.length} images embedded, ${((Date.now() - t1) / files.length).toFixed(0)} ms each, dim ${Object.values(images)[0].length}`);

// Text probes, to see which visible traits the model separates.
const probes = {
  glasses: 'a person wearing glasses',
  long_hair: 'a person with long hair',
  short_hair: 'a person with short hair',
  beard: 'a man with a beard',
  smiling: 'a person smiling broadly',
  woman: 'a photo of a woman',
  man: 'a photo of a man',
  older: 'an older person with grey hair',
  young: 'a young adult',
};
const texts = {};
for (const [name, text] of Object.entries(probes)) {
  texts[name] = Array.from((await embed([`task: search result | query: ${text}`])).data);
}
writeFileSync(outJson, JSON.stringify({ images, texts }));
console.log('wrote', outJson);
