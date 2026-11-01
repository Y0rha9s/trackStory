import type { Img } from "../ocr/image";
import type { Recognize } from "../ocr/neural";

/**
 * Motor Tesseract en un Web Worker, cargado de forma perezosa la primera vez que el matcher
 * de glifos no está seguro. Runtime y modelo se sirven desde /ocr (mismo sitio, sin CDN).
 */
let workerPromise: Promise<import("tesseract.js").Worker> | null = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await import("tesseract.js");
      const base = new URL("./ocr/", document.baseURI).href;
      const worker = await createWorker("eng", 1, {
        workerPath: base + "worker.min.js",
        corePath: base,
        langPath: base,
        gzip: true,
        workerBlobURL: false,
      });
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789.,[]%",
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
      });
      return worker;
    })();
    workerPromise.catch(() => (workerPromise = null));
  }
  return workerPromise;
}

const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;

export const recognizeInBrowser: Recognize = async (img: Img) => {
  const worker = await getWorker();
  canvas!.width = img.width;
  canvas!.height = img.height;
  canvas!.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  const { data } = await worker.recognize(canvas!);
  return { text: data.text.trim(), confidence: data.confidence };
};
