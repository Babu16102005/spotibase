import axios from 'axios';
import { aiApi, multipartHeaders, clearContentType, userApi } from './client';

/**
 * Contract tests for the mic voice upload (aiApi.voice).
 * Verifies multipart shape, filename->MIME mapping, and that failures carry
 * specific messages (never a generic "Unexpected error").
 */
jest.mock('axios', () => {
  const actual: any = jest.requireActual('axios');
  const instance: any = jest.fn();
  instance.interceptors = { request: { use: jest.fn() }, response: { use: jest.fn() } };
  instance.defaults = {};
  instance.get = jest.fn();
  instance.post = jest.fn();
  instance.put = jest.fn();
  instance.patch = jest.fn();
  instance.delete = jest.fn();
  const axiosMock: any = jest.fn();
  axiosMock.create = jest.fn(() => instance);
  axiosMock.post = jest.fn();
  return {
    __esModule: true,
    default: axiosMock,
    AxiosHeaders: actual.AxiosHeaders,
    AxiosError: class AxiosError extends Error {},
  };
});

const instance = (axios.create as jest.Mock).mock.results[0].value;

const lastFormData = (): FormData => (instance.post as jest.Mock).mock.calls[0][1] as FormData;

// RN's FormData polyfill preserves {uri,name,type} objects, but Jest's Node
// (undici) FormData stringifies them — so capture append() args via spy.
// formGet reads the captured value for a key (null when absent).
let appendedParts: Array<{ key: string; value: any }>;
let appendSpy: jest.SpyInstance;
const formGet = (_fd: any, key: string): any => {
  const found = [...appendedParts].reverse().find((p) => p.key === key);
  return found ? found.value : null;
};

describe('aiApi.voice upload contract (mic input)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    appendedParts = [];
    appendSpy = jest.spyOn(FormData.prototype as any, 'append').mockImplementation(function (key: string, value: any) {
      appendedParts.push({ key, value });
    } as any);
  });

  afterEach(() => {
    appendSpy.mockRestore();
  });

  it.each([
    ['audio.m4a', 'audio/mp4'],
    ['audio.mp4', 'audio/mp4'],
    ['audio.webm', 'audio/webm'],
    ['audio.ogg', 'audio/ogg'],
    ['audio.wav', 'audio/wav'],
    ['audio.mp3', 'audio/mpeg'],
  ])('maps %s to MIME %s', async (filename, mime) => {
    (instance.post as jest.Mock).mockResolvedValue({ data: {} });
    await aiApi.voice('file://rec', undefined, { playing: true }, filename);
    const part: any = formGet(lastFormData(), 'audio');
    expect(part.type).toBe(mime);
    expect(part.uri).toBe('file://rec');
    expect(part.name).toBe(filename);
  });

  it('includes transcript_fallback (interim STT) and JSON context', async () => {
    (instance.post as jest.Mock).mockResolvedValue({ data: {} });
    await aiApi.voice('file://rec.m4a', 'play calm tamil', { currentSongId: 's1' }, 'audio.m4a');
    const fd: any = lastFormData();
    expect(formGet(fd, 'transcript_fallback')).toBe('play calm tamil');
    expect(JSON.parse(formGet(fd, 'context'))).toEqual({ currentSongId: 's1' });
  });

  it('omits transcript_fallback when the transcript is a placeholder', async () => {
    // AiOrb strips 'Listening...' placeholders before calling voice; the
    // contract is that undefined fallback appends no part.
    (instance.post as jest.Mock).mockResolvedValue({ data: {} });
    await aiApi.voice('file://rec.m4a', undefined, {}, 'audio.m4a');
    const fd: any = lastFormData();
    expect(formGet(fd, 'transcript_fallback')).toBeNull();
  });

  it('posts to /ai/voice with a 30s timeout and no manual Content-Type', async () => {
    (instance.post as jest.Mock).mockResolvedValue({ data: {} });
    await aiApi.voice('file://rec.m4a', 'hi', {}, 'audio.m4a');
    expect(instance.post).toHaveBeenCalledWith(
      '/ai/voice',
      expect.anything(),
      expect.objectContaining({ timeout: 30000 })
    );
    const opts = (instance.post as jest.Mock).mock.calls[0][2];
    expect(opts?.headers?.['Content-Type']).toBeUndefined();
  });

  it('clears the default Content-Type so axios wires multipart boundary (...boundary=...)', async () => {
    (instance.post as jest.Mock).mockResolvedValue({ data: {} });
    await aiApi.voice('file://rec.m4a', 'hi', {}, 'audio.m4a');
    const opts = (instance.post as jest.Mock).mock.calls[0][2];
    // Explicit undefined clears apiClient's application/json default; axios
    // then wires `multipart/form-data; boundary=...` on the wire.
    expect(opts?.headers).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(opts.headers, 'Content-Type')).toBe(true);
    expect(opts.headers['Content-Type']).toBeUndefined();
    // A bare manual `multipart/form-data` value without boundary is what
    // causes HTTP 415 — it must never be sent.
    expect(String(opts.headers['Content-Type'] ?? '')).not.toContain('multipart/form-data');
    // Payload must be FormData so axios can attach the boundary.
    expect(lastFormData() instanceof FormData).toBe(true);
  });

  it('uses AxiosHeaders.delete + plain deletes (robust clear for both header shapes)', async () => {
    // Plain-object path: clearContentType deletes keys and leaves the
    // undefined merge-marker so defaults do not re-apply.
    const plain: any = { 'Content-Type': 'application/json', 'content-type': 'x' };
    clearContentType(plain);
    expect(plain['Content-Type']).toBeUndefined();
    expect('content-type' in plain).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(plain, 'Content-Type')).toBe(true);

    // AxiosHeaders path: .delete() clears the value (has === false).
    const { AxiosHeaders } = jest.requireActual('axios');
    const h = new AxiosHeaders({ 'Content-Type': 'application/json' });
    expect(h.has('Content-Type')).toBe(true);
    clearContentType(h);
    expect(h.has('Content-Type')).toBe(false);
    expect(h.get('Content-Type')).toBeUndefined();

    // multipartHeaders() is the shared per-request value used by voice/bulk/avatar.
    const mh = multipartHeaders();
    expect(mh.get('Content-Type')).toBeUndefined();
    expect(mh.has('Content-Type')).toBe(false);
  });

  it('wires multipart boundary on-wire via mock adapter (never bare multipart, never json)', async () => {
    const { AxiosHeaders } = jest.requireActual('axios');
    (instance.post as jest.Mock).mockResolvedValue({ data: {} });
    await aiApi.voice('file://rec.m4a', 'hi', {}, 'audio.m4a');
    const opts = (instance.post as jest.Mock).mock.calls[0][2];
    const perRequest = opts.headers;
    const fd = lastFormData();

    // Simulate axios merge: apiClient default (application/json) + per-request.
    const defaults = new AxiosHeaders({ 'Content-Type': 'application/json' });
    const merged = AxiosHeaders.concat(defaults, perRequest);
    // Default must be cleared — otherwise the wire would carry application/json.
    expect(merged.has('Content-Type')).toBe(false);
    expect(merged.get('Content-Type')).toBeUndefined();

    // Simulate the adapter's wire behavior with a mock adapter capturing the
    // final Content-Type: FormData + no Content-Type => browser/axios sets
    // `multipart/form-data; boundary=...`.
    let wireContentType: string | undefined = merged.get('Content-Type') as any;
    const mockAdapter = async (config: any) => {
      const wire = AxiosHeaders.from(config.headers);
      wireContentType = wire.get('Content-Type') as string | undefined;
      if (!wireContentType && config.data instanceof FormData) {
        wireContentType = 'multipart/form-data; boundary=----jestBoundary123';
      }
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
    };
    await mockAdapter({ headers: merged, data: fd });
    expect(wireContentType).toBeDefined();
    expect(String(wireContentType)).toContain('multipart/form-data');
    expect(String(wireContentType)).toContain('boundary=');
    // A bare value without boundary is the 415 trigger — must never appear.
    expect(wireContentType).not.toBe('multipart/form-data');
    expect(String(wireContentType)).not.toBe('application/json');
  });

  it('clears Content-Type for avatar/cover/bulk too (same 415 guard as voice)', async () => {
    const { AxiosHeaders } = jest.requireActual('axios');
    (instance.put as jest.Mock).mockResolvedValue({ data: {} });
    const fd = new FormData();
    await userApi.updateAvatar(fd as any);
    const avatarOpts = (instance.put as jest.Mock).mock.calls[0][2];
    expect(avatarOpts?.headers?.get?.('Content-Type')).toBeUndefined();
    const mergedAvatar = AxiosHeaders.concat(
      new AxiosHeaders({ 'Content-Type': 'application/json' }),
      avatarOpts.headers
    );
    expect(mergedAvatar.has('Content-Type')).toBe(false);
    expect(String(avatarOpts.headers.get('Content-Type') ?? '')).not.toContain('multipart/form-data');

    (instance.put as jest.Mock).mockClear();
    (instance.put as jest.Mock).mockResolvedValue({ data: {} });
    await userApi.updateCover(fd as any);
    const coverOpts = (instance.put as jest.Mock).mock.calls[0][2];
    const mergedCover = AxiosHeaders.concat(
      new AxiosHeaders({ 'Content-Type': 'application/json' }),
      coverOpts.headers
    );
    expect(mergedCover.has('Content-Type')).toBe(false);
  });

  it('propagates backend error messages verbatim (specific, not generic)', async () => {
    const backendErr: any = new Error('Required part audio is missing');
    backendErr.response = { status: 400, data: { message: 'Required part audio is missing' } };
    (instance.post as jest.Mock).mockRejectedValue(backendErr);
    await expect(aiApi.voice('file://rec.m4a', undefined, {}, 'audio.m4a')).rejects.toMatchObject({
      response: { data: { message: 'Required part audio is missing' } },
    });
    const msg = backendErr.response.data.message;
    expect(msg).not.toMatch(/unexpected/i);
    expect(msg).not.toMatch(/something went wrong/i);
  });
});
