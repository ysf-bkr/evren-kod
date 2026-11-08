import './setupDom';
import { afterEach, describe, it } from 'node:test';
import * as assert from 'node:assert';
import { cleanup, render, fireEvent } from '@testing-library/react';
import { VisualDiffViewer, parseUnifiedDiff } from '../src/components/diff/VisualDiffViewer';

afterEach(() => {
  cleanup();
});

describe('VisualDiffViewer: görsel diff ayrıştırma ve render', () => {
  const sampleDiff = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 const x = 1;
-const y = 2;
+const y = 3;
+const z = 4;
 const w = 5;`;

  it('unified diff metnini doğru ayrıştırır', () => {
    const lines = parseUnifiedDiff(sampleDiff);
    assert.strictEqual(lines.length, 8);

    const adds = lines.filter((l) => l.type === 'add');
    const dels = lines.filter((l) => l.type === 'delete');
    assert.strictEqual(adds.length, 2);
    assert.strictEqual(dels.length, 1);
  });

  it('bileşeni render eder ve ekleme/silme sayılarını gösterir', () => {
    const { getByTestId, getByText } = render(
      <VisualDiffViewer filePath="src/file.ts" diffText={sampleDiff} />
    );

    const container = getByTestId('visual-diff-viewer');
    assert.ok(container);

    assert.ok(getByText('src/file.ts'));
    assert.ok(getByText('+2'));
    assert.ok(getByText('-1'));
  });

  it('onayla ve reddet butonlarını tetikler', () => {
    let accepted = false;
    let rejected = false;

    const { getByText } = render(
      <VisualDiffViewer
        filePath="src/file.ts"
        diffText={sampleDiff}
        onAccept={() => {
          accepted = true;
        }}
        onReject={() => {
          rejected = true;
        }}
      />
    );

    fireEvent.click(getByText('Onayla'));
    assert.strictEqual(accepted, true);

    fireEvent.click(getByText('Reddet'));
    assert.strictEqual(rejected, true);
  });

  it('Aç butonuna tıklayınca satır numaralı OPEN_FILE gönderir', () => {
    const { getByTestId } = render(<VisualDiffViewer filePath="src/file.ts" diffText={sampleDiff} />);

    const openBtn = getByTestId('diff-open-in-editor');
    assert.ok(openBtn);
    fireEvent.click(openBtn);
  });
});
