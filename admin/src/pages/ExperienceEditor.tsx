import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { AdminPage } from '../components/AdminShell'
import { ConfirmDialog, useToast } from '../components/overlays'
import { ImageAssetPanel } from '../components/panels'
import { Button, Card, InlineAlert, MultiSelectAll, PageHeader, SelectField, StatusChip, SwitchRow, TextArea, TextField } from '../components/ui'
import { type Experience, experienceCategories, experiences, frameStyles, ornaments } from '../data/mock'

const blank: Experience = {
  id: '',
  name: '',
  description: '',
  category: experienceCategories[0],
  status: 'draft',
  enabled: true,
  sort_order: 10,
  compatible_frame_style_ids: [],
  compatible_ornament_ids: [],
  max_ornaments: 3,
  internal_prompt: '',
  preview_status: 'MISSING',
  preview_error: null,
  updated_at: '',
  updated_by: '',
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function ExperienceEditor() {
  const { id } = useParams()
  const creating = !id || id === 'new'
  const navigate = useNavigate()
  const toast = useToast()
  const source = creating ? blank : experiences.find((e) => e.id === id)
  const [form, setForm] = useState<Experience>(source ?? blank)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState(form.preview_status)
  const [deleting, setDeleting] = useState(false)
  const [hasThumb, setHasThumb] = useState(preview === 'READY')

  // Stand-in for polling GET /preview-jobs/:id while a preview is generating.
  useEffect(() => {
    if (preview !== 'GENERATING') return
    const t = setTimeout(() => {
      setPreview('READY')
      setHasThumb(true)
      toast({ tone: 'success', title: 'Preview ready', body: form.name || 'The new preview is available.' })
    }, 3500)
    return () => clearTimeout(t)
  }, [preview, form.name, toast])

  const set = <K extends keyof Experience>(key: K, value: Experience[K]) => setForm((f) => ({ ...f, [key]: value }))

  const validate = () => {
    const e: Record<string, string> = {}
    if (creating) {
      if (!SLUG.test(form.id)) e.id = 'Use lowercase letters, numbers and single hyphens, e.g. space-commander.'
      else if (experiences.some((x) => x.id === form.id)) e.id = 'An experience with this ID already exists.'
    }
    if (!form.name.trim()) e.name = 'Name is required.'
    if (!form.internal_prompt.trim()) e.internal_prompt = 'The internal prompt is required.'
    if (form.max_ornaments < 0 || form.max_ornaments > 10) e.max_ornaments = 'Choose a number from 0 to 10.'
    if (form.status === 'published' && preview !== 'READY') e.status = 'Only experiences with a ready preview can be published.'
    return e
  }

  const save = () => {
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length) {
      toast({ tone: 'warning', title: 'Fix the highlighted fields', body: 'Nothing was saved.' })
      return
    }
    toast({ tone: 'success', title: creating ? 'Experience created' : 'Experience saved', body: form.name })
    navigate('/experiences')
  }

  if (!source)
    return (
      <AdminPage crumbs={[{ label: 'Catalog' }, { label: 'Experiences', to: '/experiences' }, { label: 'Not found' }]} roles={['content_manager']}>
        <InlineAlert tone="danger" title="Experience not found">
          No experience has the ID <code className="t-mono">{id}</code>.
        </InlineAlert>
      </AdminPage>
    )

  return (
    <AdminPage crumbs={[{ label: 'Catalog' }, { label: 'Experiences', to: '/experiences' }, { label: creating ? 'New experience' : form.name }]} roles={['content_manager']}>
      <PageHeader
        title={creating ? 'New experience' : form.name}
        subtitle={creating ? 'Starts as a draft. Publish it once the preview is ready.' : `Last updated ${form.updated_at} by ${form.updated_by}`}
        actions={
          <>
            {!creating && (
              <Button variant="tertiary" icon={Trash2} className="text-danger hover:bg-danger-soft" onClick={() => setDeleting(true)}>
                Delete
              </Button>
            )}
            <Button variant="secondary" onClick={() => navigate('/experiences')}>
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </>
        }
      />
      <div className="flex items-start gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <Card title="Details">
            <div className="grid grid-cols-2 gap-x-5 gap-y-5">
              <TextField label="ID" mono value={form.id} disabled={!creating} onChange={(e) => set('id', e.target.value.trim())} helper={creating ? 'Permanent. Used in URLs and job records.' : 'The ID can’t be changed after creation.'} error={errors.id} />
              <TextField label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} error={errors.name} />
              <div className="col-span-2">
                <TextField label="Description" value={form.description} onChange={(e) => set('description', e.target.value)} helper="Shown on the customer style card." />
              </div>
              <SelectField label="Category" value={form.category} onChange={(e) => set('category', e.target.value)} options={experienceCategories.map((c) => ({ value: c, label: c }))} />
              <SelectField label="Status" value={form.status} onChange={(e) => set('status', e.target.value as Experience['status'])} error={errors.status} options={[{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }, { value: 'disabled', label: 'Disabled' }]} />
              <TextField label="Sort order" type="number" min={0} value={form.sort_order} onChange={(e) => set('sort_order', Number(e.target.value))} helper="Lower numbers appear first." />
              <TextField label="Max ornaments" type="number" min={0} max={10} value={form.max_ornaments} onChange={(e) => set('max_ornaments', Number(e.target.value))} helper="0 hides the ornaments section for customers." error={errors.max_ornaments} />
              <div className="col-span-2">
                <SwitchRow label="Enabled" description="Turn off to hide this style without changing its status." checked={form.enabled} onChange={(v) => set('enabled', v)} />
              </div>
            </div>
          </Card>

          <Card title="Prompt">
            <InlineAlert tone="warning">The internal prompt is for admins only. It is never shown to customers.</InlineAlert>
            <div className="mt-4">
              <TextArea label="Internal prompt" mono rows={7} value={form.internal_prompt} onChange={(e) => set('internal_prompt', e.target.value)} error={errors.internal_prompt} />
            </div>
          </Card>

          <Card title="Compatibility">
            <div className="flex flex-col gap-6">
              <MultiSelectAll label="Compatible frame styles" helper="“All” means every enabled frame style." options={frameStyles.map(({ id, name }) => ({ id, name }))} value={form.compatible_frame_style_ids} onChange={(v) => set('compatible_frame_style_ids', v)} />
              <MultiSelectAll label="Compatible ornaments" helper="Customers can pick up to the max ornaments above." options={ornaments.map(({ id, name }) => ({ id, name }))} value={form.compatible_ornament_ids} onChange={(v) => set('compatible_ornament_ids', v)} />
            </div>
          </Card>
        </div>

        <div className="w-80 shrink-0">
          <ImageAssetPanel
            title="Thumbnail & preview"
            aspect="aspect-[2/3]"
            present={hasThumb}
            seed={form.sort_order}
            status={preview.toLowerCase()}
            busy={preview === 'GENERATING'}
            error={preview === 'FAILED' ? (form.preview_error ?? 'The preview job failed.') : undefined}
            constraints="JPG, PNG or WebP · 2:3 portrait · up to 12 MB. Generating a preview uses the shared portrait source."
            onUpload={() => {
              setHasThumb(true)
              setPreview('READY')
              toast({ tone: 'success', title: 'Thumbnail uploaded' })
            }}
            onRemove={() => {
              setHasThumb(false)
              setPreview('MISSING')
            }}
            onGenerate={() => {
              if (creating && !form.id) {
                toast({ tone: 'warning', title: 'Add an ID first', body: 'Save the experience once before generating a preview.' })
                return
              }
              setPreview('GENERATING')
            }}
            generateLabel={preview === 'FAILED' ? 'Try again' : 'Generate preview'}
            footer={
              preview === 'GENERATING' ? (
                <p className="t-caption text-text-muted">Checking the preview job every few seconds…</p>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="t-caption text-text-muted">Preview status</span>
                  <StatusChip value={preview.toLowerCase()} />
                </div>
              )
            }
          />
        </div>
      </div>

      {deleting && (
        <ConfirmDialog
          title="Delete this experience?"
          description={`“${form.name}” is removed permanently. Past generations keep their record but the style no longer appears anywhere.`}
          confirmLabel="Delete experience"
          confirmText="I understand this can’t be undone"
          destructive
          onClose={() => setDeleting(false)}
          onConfirm={() => {
            toast({ tone: 'success', title: 'Experience deleted', body: form.name })
            navigate('/experiences')
          }}
        />
      )}
    </AdminPage>
  )
}
