import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

export async function readFileAsBase64(uri: string): Promise<string> {
  console.log('[fileHelpers] readFileAsBase64 called', { uri: uri.substring(0, 80), platform: Platform.OS });
  if (Platform.OS === 'web') {
    // blob: URI — fetch it and convert ArrayBuffer → base64
    if (uri.startsWith('blob:')) {
      console.log('[fileHelpers] readFileAsBase64 (web) fetching blob URI');
      const response = await fetch(uri);
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      console.log('[fileHelpers] readFileAsBase64 (web blob) complete, length:', base64.length);
      return base64;
    }
    // data-URL — strip the prefix
    if (uri.includes(',')) {
      const base64 = uri.split(',')[1];
      console.log('[fileHelpers] readFileAsBase64 (web data-URL) extracted base64, length:', base64.length);
      return base64;
    }
    // Generic fallback: fetch the URI and convert to base64
    // This handles http:, https:, file:, and any opaque URI from DocumentPicker on web
    console.log('[fileHelpers] readFileAsBase64 (web) generic fetch fallback for URI type');
    try {
      const response = await fetch(uri);
      if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      console.log('[fileHelpers] readFileAsBase64 (web generic fetch) complete, length:', base64.length);
      return base64;
    } catch (fetchErr) {
      console.error('[fileHelpers] readFileAsBase64 (web) all strategies failed:', fetchErr);
      throw new Error('Impossibile leggere il file. Prova a riaprire il file picker.');
    }
  }
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  console.log('[fileHelpers] readFileAsBase64 (native) complete, length:', base64.length);
  return base64;
}

export async function saveAndShareFile(base64: string, fileName: string): Promise<void> {
  console.log('[fileHelpers] saveAndShareFile called', { fileName, platform: Platform.OS });
  if (Platform.OS === 'web') {
    // Web: trigger browser download
    const link = document.createElement('a');
    link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`;
    link.download = fileName;
    link.click();
    console.log('[fileHelpers] saveAndShareFile (web) download triggered');
    return;
  }
  // Native: save to cache and share
  const fileUri = FileSystem.cacheDirectory + fileName;
  await FileSystem.writeAsStringAsync(fileUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  console.log('[fileHelpers] file saved to', fileUri);
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(fileUri, {
      mimeType: fileName.endsWith('.xlsx')
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv',
      dialogTitle: `Esporta ${fileName}`,
    });
    console.log('[fileHelpers] file shared successfully');
  } else {
    console.log('[fileHelpers] sharing not available on this platform');
  }
}
