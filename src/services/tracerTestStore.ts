/**
 * Files for Shot Tracer field tests: kept clips live in the app's documents folder (so they
 * survive), and the JSON report is written on demand for sharing.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';

import { tracerTestReport, type TracerTestRecord } from '@/domain/tracerTests';

const folder = () => new Directory(Paths.document, 'tracer-tests');

/** Copy a clip into the tests folder and return its file name. */
export async function keepClip(uri: string, id: string): Promise<string> {
  const dir = folder();
  if (!dir.exists) dir.create({ intermediates: true });
  const name = `shot-${id}.mp4`;
  const dest = new File(dir, name);
  if (dest.exists) dest.delete();
  await new File(uri).copy(dest);
  return name;
}

export function clipUri(name: string): string {
  return new File(folder(), name).uri;
}

export function deleteTestClip(name: string) {
  try {
    const f = new File(folder(), name);
    if (f.exists) f.delete();
  } catch {
    // already gone
  }
}

async function share(uri: string, mimeType: string, dialogTitle: string) {
  if (!(await isAvailableAsync())) throw new Error('Sharing is not available on this device');
  await shareAsync(uri, { mimeType, dialogTitle });
}

/** Write the full JSON report and open the share sheet. */
export async function shareReport(records: TracerTestRecord[]) {
  const file = new File(Paths.cache, `tracer-tests-${new Date().toISOString().slice(0, 10)}.json`);
  if (file.exists) file.delete();
  await file.write(JSON.stringify(tracerTestReport(records), null, 2));
  await share(file.uri, 'application/json', 'Share tracer test report');
}

export async function shareClip(name: string) {
  await share(clipUri(name), 'video/mp4', 'Share test clip');
}
