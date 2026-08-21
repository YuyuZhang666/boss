import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyWechatBuild } from '../../scripts/verify-wechat-build.mjs';

function fixture(orientation = 'portrait', compileType = 'game') {
  const root = mkdtempSync(join(tmpdir(), 'boss-game-build-'));
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'game.json'), JSON.stringify({ deviceOrientation: orientation }));
  writeFileSync(join(root, 'project.config.json'), JSON.stringify({ appid: 'wx-test-appid', compileType }));
  writeFileSync(join(root, 'game.js'), 'console.log("ok")');
  return root;
}

describe('verifyWechatBuild', () => {
  it('accepts a portrait build with an appid', () => {
    expect(verifyWechatBuild(fixture()).appid).toBe('wx-test-appid');
  });

  it('rejects a landscape build', () => {
    expect(() => verifyWechatBuild(fixture('landscape'))).toThrow('portrait');
  });

  it('rejects a mini-program build', () => {
    expect(() => verifyWechatBuild(fixture('portrait', 'miniprogram'))).toThrow('compileType');
  });
});
