import { NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';
import { createClient } from '@supabase/supabase-js';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';

// Configurar FFmpeg para entornos serverless (Vercel)
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabaseUrl = 'https://cezgntxyurzgctwwvmib.supabase.co';
const supabaseKey = 'sb_publishable_bd2aLD19H3XlqK_yZ5p-rQ_gGP6mXtc';

// Función auxiliar para extraer fotogramas del vídeo guardado en /tmp
async function extractFrames(videoPath: string, outputDir: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        count: 3, // Extrae 3 fotogramas clave (inicio, mitad, final)
        folder: outputDir,
        filename: 'frame-%i.jpg',
        size: '640x360' // Tamaño optimizado para análisis visual rápido y económico
      })
      .on('end', () => {
        try {
          const files = fs.readdirSync(outputDir)
            .filter(f => f.startsWith('frame-') && f.endsWith('.jpg'))
            .map(f => path.join(outputDir, f));
          resolve(files);
        } catch (e) {
          reject(e);
        }
      })
      .on('error', (err) => {
        reject(err);
      });
  });
}

export async function POST(req: Request) {
  let tempVideoPath = '';
  let tempDir = '';

  try {
    const { fileName } = await req.json();

    if (!fileName) {
      return NextResponse.json({ error: 'No se proporcionó el archivo' }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Descargar vídeo de Supabase
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('audios-oratoria')
      .download(fileName);

    if (downloadError || !fileData) {
      throw new Error(`No se pudo descargar de Supabase: ${downloadError?.message}`);
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Guardar temporalmente en el directorio /tmp (único directorio con permisos de escritura en Vercel)
    tempDir = fs.mkdtempSync(path.join(osTmpDir(), 'oratoria-'));
    tempVideoPath = path.join(tempDir, fileName || 'video.webm');
    fs.writeFileSync(tempVideoPath, buffer);

    // 2. Transcribir audio con Whisper
    const fileForWhisper = await toFile(buffer, fileName || 'video.webm', { type: 'video/webm' });
    const transcription = await openai.audio.transcriptions.create({
      file: fileForWhisper,
      model: 'whisper-1',
    });

    // 3. Extraer fotogramas para el análisis visual multimodal
    let frameBase64List: string[] = [];
    try {
      const framePaths = await extractFrames(tempVideoPath, tempDir);
      frameBase64List = framePaths.map(filePath => {
        const frameBuffer = fs.readFileSync(filePath);
        return frameBuffer.toString('base64');
      });
    } catch (frameErr) {
      console.warn("Aviso: No se pudieron extraer fotogramas, continuando solo con análisis de texto y audio.", frameErr);
    }

    // 4. Preparar contenido multimodal para GPT-4o
    const userContent: any[] = [
      { 
        type: "text", 
        text: `Transcripción del discurso: "${transcription.text}". Analiza rigurosamente tanto el texto como las imágenes del orador adjuntas (postura, expresión corporal, contacto visual). Asigna métricas numéricas reales y objetivas basadas en lo que observas.` 
      }
    ];

    // Inyectar los fotogramas en el array si se extrajeron correctamente
    frameBase64List.forEach((base64Img) => {
      userContent.push({
        type: "image_url",
        image_url: {
          url: `data:image/jpeg;base64,${base64Img}`
        }
      });
    });

    // 5. Llamada a GPT-4o con Visión y Audio combinados
    const analysis = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Eres un maestro experto en oratoria ejecutiva, lenguaje no verbal y análisis de liderazgo. 
          Evalúa tanto la transcripción como los fotogramas visuales del orador. 
          Devuelve un JSON estricto con exactamente estas claves y tipos de datos:
          {
            "fortalezaTitulo": "Título corto de la fortaleza principal detectada",
            "fortalezaDesc": "Descripción detallada evaluando tono, lenguaje corporal y conexión.",
            "areaCrecimientoTitulo": "Área de mejora principal detectada",
            "areaCrecimientoDesc": "Análisis profundo de la postura, la mirada o el cierre del discurso.",
            "consejosPracticos": ["Consejo 1 con ejemplo aplicado", "Consejo 2 de presencia y estructura"],
            "tonosDetectados": ["Apasionado", "Inspirador", "Seguro"],
            "analisisTono": "Párrafo explicando la seguridad y convicción mostrada en la voz.",
            "presenciaVisualEtiquetas": ["Profesional", "Autoritativo", "Seguro"],
            "analisisVisual": "Párrafo evaluando explícitamente la postura corporal, la rigidez y el contacto visual con la cámara basado en las imágenes.",
            "metrics": {
              "ritmoPalabrasPorMinuto": <número entero realista calculado>,
              "contactoVisualScore": "<puntuación real sobre 5, ej: '4 / 5'>",
              "contactoVisualPorcentaje": "<porcentaje real, ej: '80%'>",
              "muletillasDetectadas": <número entero de muletillas contadas>,
              "persuasionScore": "<puntuación real sobre 10, ej: '8 / 10'>"
            }
          }`
        },
        { role: 'user', content: userContent }
      ],
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(analysis.choices[0].message.content || '{}');

    // Limpieza de archivos temporales
    try {
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.error("Error limpiando temporales:", cleanupErr);
    }

    return NextResponse.json({
      success: true,
      data: result
    });

  } catch (err: any) {
    // Limpieza de emergencia en caso de error
    try {
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}

    console.error("Error Multimodal IA:", err);
    return NextResponse.json({ error: `Fallo en procesamiento multimodal: ${err.message}` }, { status: 500 });
  }
}

// Función auxiliar para obtener el directorio temporal del sistema operativo
function osTmpDir() {
  return require('os').tmpdir();
}