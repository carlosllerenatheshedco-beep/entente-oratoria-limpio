import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cezgntxyurzgctwwvmib.supabase.co';
const supabaseKey = 'sb_publishable_bd2aLD19H3XlqK_yZ5p-rQ_gGP6mXtc';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const fileName = formData.get('fileName') as string;

    if (!file) {
      return NextResponse.json({ error: 'No se recibió el archivo' }, { status: 400 });
    }

    // Convertimos el archivo recibido a Buffer para Node.js
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Ejecutamos la subida real al bucket audios-oratoria
    const { data, error } = await supabase.storage
      .from('audios-oratoria')
      .upload(fileName, buffer, {
        contentType: file.type || 'audio/webm',
        upsert: true,
      });

    if (error) {
      return NextResponse.json({ error: `FALLO EN SUBIDA (Storage): ${error.message}` }, { status: 500 });
    }

    // Obtenemos la URL pública del archivo para el siguiente paso de análisis
    const { data: publicUrlData } = supabase.storage
      .from('audios-oratoria')
      .getPublicUrl(data.path);

    return NextResponse.json({ 
      success: true, 
      path: data.path,
      publicUrl: publicUrlData.publicUrl 
    });

  } catch (err: any) {
    return NextResponse.json({ error: `FALLO CRÍTICO EN BUFFER: ${err.message}` }, { status: 500 });
  }
}