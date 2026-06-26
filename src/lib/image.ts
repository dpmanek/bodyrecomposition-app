const MAX_IMAGE_SIDE = 1600;
const JPEG_QUALITY = 0.86;

export const prepareImageForExtraction = async (file: File): Promise<File> => {
  if (!file.type.startsWith('image/')) return file;

  const bitmap = await createBitmap(file);
  if (!bitmap) return file;

  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return file;

  context.drawImage(bitmap, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
  });

  if (!blob) return file;

  return new File([blob], file.name.replace(/\.[^.]+$/, '') || 'omron-reading.jpg', {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  });
};

const createBitmap = async (file: File): Promise<ImageBitmap | HTMLImageElement | null> => {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return loadImageElement(file);
  }
};

const loadImageElement = (file: File): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
