const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_UPLOAD_BYTES = 1.5 * 1024 * 1024;
const MAX_SIDE = 2000;
const REENCODE_QUALITY = 0.9;

/** Decodes the file at no more than `MAX_SIDE` on its longer side; `createImageBitmap` also applies EXIF rotation. */
const drawScaled = async (
  file: File,
): Promise<{ context: CanvasRenderingContext2D; canvas: HTMLCanvasElement; resized: boolean }> => {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Không đọc được ảnh này. Vui lòng chọn ảnh JPG, PNG hoặc WebP khác.");
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Trình duyệt không hỗ trợ xử lý ảnh.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { context, canvas, resized: scale < 1 };
};

/** The text of the first QR code found in the photo, or `undefined` when there is none or the photo cannot be read. */
export const decodeQrFromImage = async (file: File): Promise<string | undefined> => {
  let drawn;
  try {
    drawn = await drawScaled(file);
  } catch {
    return undefined;
  }
  // Dynamic on purpose: keeps jsQR out of the main bundle until a shopper actually uploads a prescription.
  const { default: jsQR } = await import("jsqr");
  const { width, height } = drawn.canvas;
  const image = drawn.context.getImageData(0, 0, width, height);
  return jsQR(image.data, width, height, { inversionAttempts: "dontInvert" })?.data;
};

/** Keeps a small supported photo as it is and re-encodes anything larger to a JPEG the server accepts. */
export const prepareImageForUpload = async (file: File): Promise<Blob> => {
  if (!UPLOAD_TYPES.includes(file.type)) {
    throw new Error("Định dạng ảnh không được hỗ trợ. Vui lòng chọn ảnh JPG, PNG hoặc WebP.");
  }
  const { canvas, resized } = await drawScaled(file);
  if (!resized && file.size <= MAX_UPLOAD_BYTES) return file;
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Không xử lý được ảnh. Vui lòng thử ảnh khác."))),
      "image/jpeg",
      REENCODE_QUALITY,
    );
  });
};
