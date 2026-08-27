import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const runtime = 'nodejs';

const supabaseUrl = 'https://cezgntxyurzgctwwvmib.supabase.co';
const supabaseKey = 'sb_publishable_bd2aLD19H3XlqK_yZ5p-rQ_gGP6mXtc';
const ffmpegBinaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const ffmpegLocalPath = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', ffmpegBinaryName);

if (!fs.existsSync(ffmpegLocalPath)) {
  throw new Error(`ffmpeg no esta disponible en ${ffmpegLocalPath}.`);
}

ffmpeg.setFfmpegPath(ffmpegLocalPath);

const convertirVideoAWav = (inputPath: string, outputPath: string) =>
  new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec('pcm_s16le')
      .format('wav')
      .on('end', () => resolve())
      .on('error', (error) => reject(error))
      .save(outputPath);
  });

export async function POST(req: Request) {
  let tempDir = '';

  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No se recibio el video.' }, { status: 400 });
    }

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oratoria-upload-'));

    const extension = path.extname(file.name || '') || '.mp4';
    const inputPath = path.join(tempDir, `source${extension}`);
    const outputPath = path.join(tempDir, 'audio.wav');
    const fileName = `audio_entente_${Date.now()}.wav`;

    const arrayBuffer = await file.arrayBuffer();
    fs.writeFileSync(inputPath, Buffer.from(arrayBuffer));

    await convertirVideoAWav(inputPath, outputPath);

    const wavBuffer = fs.readFileSync(outputPath);
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { error } = await supabase.storage.from('audios-oratoria').upload(fileName, wavBuffer, {
      contentType: 'audio/wav',
      upsert: true,
    });

    if (error) {
      return NextResponse.json({ error: `FALLO EN SUBIDA (Storage): ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      fileName,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `No se ha podido preparar el audio del video subido. ${err.message}` },
      { status: 500 }
    );
  } finally {
    try {
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  }
}
