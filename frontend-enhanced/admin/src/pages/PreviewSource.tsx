import { useState } from 'react'
import { ConfirmDialog, useToast } from '../components/overlays'
import { AdminPage } from '../components/AdminShell'
import { ImageAssetPanel } from '../components/panels'
import { Card, CodeValue, InlineAlert, KeyValueList, PageHeader } from '../components/ui'
import { previewSource } from '../data/mock'

export function PreviewSource() {
  const toast = useToast()
  const [pending, setPending] = useState<File | null>(null)
  const [meta, setMeta] = useState(previewSource)

  return (
    <AdminPage crumbs={[{ label: 'Catalog' }, { label: 'Preview source' }]} roles={['content_manager']}>
      <PageHeader title="Preview source" subtitle="The one demo portrait every AI preview is generated from" />
      <div className="flex items-start gap-6">
        <div className="w-80 shrink-0">
          <ImageAssetPanel title="portrait-default" aspect="aspect-[2/3]" present={meta.has_asset} seed={6} constraints="JPG, PNG or WebP · portrait · a clear, front-facing, neutral expression · up to 12 MB." onUpload={setPending} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <Card title="Details">
            <KeyValueList
              items={[
                ['Source ID', <CodeValue value={meta.id} />],
                ['Type', meta.source_type],
                ['File type', meta.content_type],
                ['Updated', meta.updated_at],
                ['Updated by', meta.updated_by],
              ]}
            />
          </Card>
          <InlineAlert tone="warning" title="Replacing this changes future previews">
            Existing previews are not regenerated automatically. After replacing the portrait, use “Generate missing previews” on the Experiences page, or regenerate each preview from its editor. Only the <code className="t-mono">portrait-default</code> source can be replaced.
          </InlineAlert>
        </div>
      </div>
      {pending && (
        <ConfirmDialog
          title="Replace the preview source?"
          description={`${pending.name} will replace the current portrait.`}
          confirmLabel="Replace portrait"
          confirmText="I understand new previews will look different"
          onClose={() => setPending(null)}
          onConfirm={() => {
            setMeta({ ...meta, updated_at: new Date().toISOString().slice(0, 16).replace('T', ' '), updated_by: 'adm_01' })
            setPending(null)
            toast({ tone: 'success', title: 'Preview source replaced' })
          }}
        />
      )}
    </AdminPage>
  )
}
