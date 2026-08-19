import { NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabaseUrl = 'https://cezgntxyurzgctwwvmib.supabase.co';
const supabaseKey = 'sb_publishable_bd2aLD19H3XlqK_yZ5p-rQ_gGP6mXtc';

export async function POST(req: Request) {
  try {
    const { fileName } = await req.json();

    if (!fileName) {
      return NextResponse.json({ error: 'No se proporcionó el archivo' }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: fileData, error: downloadError } = await supabase.storage
      .from('audios-oratoria')
      .download(fileName);

    if (downloadError || !fileData) {
      throw new Error(`No se pudo descargar de Supabase: ${downloadError?.message}`);
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const file = await toFile(buffer, fileName || 'video.webm', { type: 'video/webm' });

    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: 'whisper-1',
    });

    // Análisis de nivel superior superando a Yoodli
    const analysis = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Eres un maestro experto en oratoria ejecutiva y análisis de liderazgo. Analiza la transcripción y el vídeo simulado. 
          Devuelve un JSON estricto con exactamente estas claves y tipos de datos:
          {
            "fortalezaTitulo": "Título corto de la fortaleza principal",
            "fortalezaDesc": "Descripción detallada de por qué conecta emocionalmente.",
            "areaCrecimientoTitulo": "Área de mejora principal",
            "areaCrecimientoDesc": "Análisis profundo de lo que faltó en el discurso o cierre.",
            "consejosPracticos": ["Consejo 1 con ejemplo aplicado", "Consejo 2 de estructura"],
            "tonosDetectados": ["Apasionado", "Inspirador", "Seguro"],
            "analisisTono": "Párrafo explicando la seguridad, el liderazgo y la convicción mostrada.",
            "presenciaVisualEtiquetas": ["Profesional", "Autoritativo", "Seguro"],
            "analisisVisual": "Párrafo evaluando la postura, la rigidez o el contacto visual con la cámara.",
            "metrics": {
              "ritmoPalabrasPorMinuto": 155,
              "contactoVisualScore": "2 / 5",
              "contactoVisualPorcentaje": "40%",
              "muletillasDetectadas": 4,
              "persuasionScore": "8 / 10"
            }
          }`
        },
        { role: 'user', content: `Transcripción: "${transcription.text}"` }
      ],
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(analysis.choices[0].message.content || '{}');

    return NextResponse.json({
      success: true,
      data: result
    });

  } catch (err: any) {
    console.error("Error IA:", err);
    return NextResponse.json({ error: `Fallo en procesamiento: ${err.message}` }, { status: 500 });
  }
}