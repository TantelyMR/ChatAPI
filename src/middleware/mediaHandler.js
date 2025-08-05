import { upload } from './multerSetup.js';
import FileType from 'file-type';
import fs from 'node:fs/promises';

const acceptedImage = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'
];
const acceptedVideo = [
  'video/mp4', 'video/webm', 'video/quicktime', 'video/qt'
];

const fieldSpec = upload.fields([
  { name: 'media', maxCount: 9 },
  { name: 'cover', maxCount: 1 }
]);

export async function mediaHandler(req, res, next) {
  fieldSpec(req, res, async err => {
    if (err) return res.status(400).json({ message: err.message });

    const mediaFiles = req.files?.media ?? [];
    const coverFiles = req.files?.cover ?? [];

    /* ---------- count + mimetype rules --------------------------- */
    if (mediaFiles.length === 0 && coverFiles.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    /* helper to detect actual mimetype if extension is wrong */
    const detect = async f => {
      const buf = await fs.readFile(f.path);
      const type = await FileType.fromBuffer(buf);
      return type?.mime ?? f.mimetype;
    };

    /* validate media files */
    if (mediaFiles.length) {
      if (mediaFiles.length === 1) {
        const mime = await detect(mediaFiles[0]);
        const ok = [...acceptedImage, ...acceptedVideo].includes(mime);
        if (!ok) return res.status(400).json({ message: 'Unsupported media type' });
      } else {
        /* multiple ⇒ must all be images */
        for (const f of mediaFiles) {
          const mime = await detect(f);
          if (!acceptedImage.includes(mime)) {
            return res.status(400).json({ message: 'All media must be images' });
          }
        }
      }
    }

    /* validate cover */
    if (coverFiles.length) {
      const mime = await detect(coverFiles[0]);
      if (!acceptedImage.includes(mime)) {
        return res.status(400).json({ message: 'Cover must be an image' });
      }
    }

    next();
  });
}
