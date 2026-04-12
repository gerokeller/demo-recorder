import { describe, expect, it } from 'vitest';
import { parseScalar, parseYaml } from '../yaml-parser.ts';

describe('parseScalar', () => {
  it('strips double quotes', () => {
    expect(parseScalar('"hello"')).toBe('hello');
  });

  it('strips single quotes', () => {
    expect(parseScalar("'hello'")).toBe('hello');
  });

  it('parses booleans', () => {
    expect(parseScalar('true')).toBe(true);
    expect(parseScalar('false')).toBe(false);
  });

  it('parses integers and floats', () => {
    expect(parseScalar('42')).toBe(42);
    expect(parseScalar('3.14')).toBe(3.14);
    expect(parseScalar('-1')).toBe(-1);
  });

  it('parses null tokens', () => {
    expect(parseScalar('null')).toBeNull();
    expect(parseScalar('~')).toBeNull();
    expect(parseScalar('')).toBeNull();
  });

  it('parses flow mappings', () => {
    expect(parseScalar('{ width: 1280, height: 720 }')).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it('parses flow arrays', () => {
    expect(parseScalar('[one, two, three]')).toEqual(['one', 'two', 'three']);
  });

  it('strips trailing inline comments', () => {
    expect(parseScalar('42   # the answer')).toBe(42);
  });

  it('falls back to string for unquoted words', () => {
    expect(parseScalar('hello')).toBe('hello');
  });
});

describe('parseYaml', () => {
  it('parses a trivial key-value mapping', () => {
    expect(parseYaml('name: showcase\ntitle: "Hello"\n')).toEqual({
      name: 'showcase',
      title: 'Hello',
    });
  });

  it('parses a nested block', () => {
    const yaml = [
      'settings:',
      '  auth: ownerUser',
      '  viewport:',
      '    width: 1920',
      '    height: 1080',
    ].join('\n');
    expect(parseYaml(yaml)).toEqual({
      settings: {
        auth: 'ownerUser',
        viewport: { width: 1920, height: 1080 },
      },
    });
  });

  it('parses a sequence of inline mappings', () => {
    const yaml = [
      'steps:',
      '  - action: navigate',
      '    path: /dashboard',
      '  - action: click',
      '    selector: button:Save',
    ].join('\n');
    expect(parseYaml(yaml)).toEqual({
      steps: [
        { action: 'navigate', path: '/dashboard' },
        { action: 'click', selector: 'button:Save' },
      ],
    });
  });

  it('skips empty lines and comments', () => {
    const yaml = ['# comment', 'name: ok', '', '# another comment', 'value: 7'].join('\n');
    expect(parseYaml(yaml)).toEqual({ name: 'ok', value: 7 });
  });

  it('parses flow arrays as values', () => {
    const yaml = 'highlights: ["A", "B", "C"]\n';
    expect(parseYaml(yaml)).toEqual({ highlights: ['A', 'B', 'C'] });
  });

  it('handles quoted strings with colons inside', () => {
    const yaml = 'description: "Sarah: Monday morning"\n';
    expect(parseYaml(yaml)).toEqual({ description: 'Sarah: Monday morning' });
  });

  it('parses a scenario-like document', () => {
    const yaml = [
      'name: demo',
      'title: "Demo"',
      'description: "A walkthrough."',
      'settings:',
      '  isolated: true',
      '  mobile:',
      '    enabled: true',
      '    layout: side-by-side',
      'steps:',
      '  - action: navigate',
      '    path: /dashboard',
      '    beat: setup',
      '  - action: click',
      '    selector: "button:Go"',
      '    beat: action',
    ].join('\n');

    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed.name).toBe('demo');
    expect(parsed.title).toBe('Demo');
    expect(parsed.settings).toEqual({
      isolated: true,
      mobile: { enabled: true, layout: 'side-by-side' },
    });
    expect(parsed.steps).toEqual([
      { action: 'navigate', path: '/dashboard', beat: 'setup' },
      { action: 'click', selector: 'button:Go', beat: 'action' },
    ]);
  });
});
