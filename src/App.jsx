import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import logoKalova from './assets/logo-kalova.png'

let idSeq = 0
function newId() {
  idSeq += 1
  return `p-${Date.now()}-${idSeq}`
}

/** Stock en unidades; si `isLooseFood`, stock = gramos disponibles. */
function createProduct({
  name,
  category,
  stock,
  priceSale,
  isLooseFood = false,
  barcode = '',
}) {
  const bc = String(barcode).replace(/\D/g, '')
  return {
    id: newId(),
    name,
    category,
    stock: Number(stock),
    priceSale: Number(priceSale),
    isLooseFood,
    barcode: bc,
  }
}

const STORAGE_PRODUCTS_KEY = 'pet-shop:inventory-v2'
const STORAGE_SALES_KEY = 'pet-shop:ventas-del-dia-v1'

function getTodayKey() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function normalizeProduct(p) {
  if (!p || typeof p !== 'object') return null
  return {
    id: String(p.id),
    name: String(p.name ?? ''),
    category: String(p.category ?? ''),
    stock: Math.max(0, Math.floor(Number(p.stock) || 0)),
    priceSale: Math.max(0, Number(p.priceSale) || 0),
    isLooseFood: Boolean(p.isLooseFood),
    barcode: String(p.barcode ?? '').replace(/\D/g, ''),
  }
}

function loadPersistedProducts() {
  try {
    const raw = localStorage.getItem(STORAGE_PRODUCTS_KEY)
    if (raw === null) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    let autoBarcode = 779_000_000_000_1
    return parsed
      .map(normalizeProduct)
      .filter(Boolean)
      .map((item) => {
        if (item.barcode && item.barcode.length >= 4) return item
        const b = String(autoBarcode++)
        return { ...item, barcode: b }
      })
  } catch {
    return []
  }
}

function loadPersistedSalesState() {
  try {
    const raw = localStorage.getItem(STORAGE_SALES_KEY)
    if (!raw) return { total: 0, transactions: 0 }
    const data = JSON.parse(raw)
    if (data?.date !== getTodayKey()) return { total: 0, transactions: 0 }
    return {
      total: Math.max(0, Number(data?.total) || 0),
      transactions: Math.max(0, Math.floor(Number(data?.transactions) || 0)),
    }
  } catch {
    return { total: 0, transactions: 0 }
  }
}

function formatArs(value) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

function isLowStock(p) {
  if (p.isLooseFood) return p.stock < 5000
  return p.stock < 5
}

function stockLabel(p) {
  if (p.isLooseFood) {
    const kg = p.stock / 1000
    return `${p.stock.toLocaleString('es-AR')} g (${kg.toFixed(2).replace('.', ',')} kg)`
  }
  return String(p.stock)
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Beep corto vía Web Audio (sin archivo). */
function playScanBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.connect(g)
    g.connect(ctx.destination)
    o.type = 'sine'
    o.frequency.value = 880
    g.gain.setValueAtTime(0.07, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1)
    o.start(ctx.currentTime)
    o.stop(ctx.currentTime + 0.1)
    setTimeout(() => void ctx.close(), 180)
  } catch {
    /* sin audio */
  }
}

function CameraIcon(props) {
  return (
    <svg
      className={props.className ?? ''}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  )
}

export default function App() {
  const savedSales = loadPersistedSalesState()
  const [products, setProducts] = useState(() => loadPersistedProducts())
  const [dailySales, setDailySales] = useState(savedSales.total)
  const [saleTransactions, setSaleTransactions] = useState(
    savedSales.transactions,
  )
  const [toast, setToast] = useState(null)
  const [query, setQuery] = useState('')
  const [isScanning, setIsScanning] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [saleGramsProductId, setSaleGramsProductId] = useState(null)
  const [gramsInput, setGramsInput] = useState('')

  const [form, setForm] = useState({
    name: '',
    category: '',
    stock: '',
    priceSale: '',
    barcode: '',
    isLooseFood: false,
  })
  const [editingProductId, setEditingProductId] = useState(null)
  const [editForm, setEditForm] = useState({
    name: '',
    category: '',
    stock: '',
    priceSale: '',
    barcode: '',
    isLooseFood: false,
  })
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  /** null | 'search' | 'new-product' — visor mínimo de cámara */
  const [barcodeCameraTarget, setBarcodeCameraTarget] = useState(null)
  const [showF1Hint, setShowF1Hint] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(min-width: 640px)').matches
      : true,
  )

  const productSearchRef = useRef(null)
  const searchScanBufRef = useRef('')
  const searchScanTimerRef = useRef(null)
  const lastSearchDigitAtRef = useRef(0)
  const [scannerFeed, setScannerFeed] = useState(null)

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return products
    if (/^\d{4,}$/.test(q)) return products
    return products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
  }, [products, query])

  const lowStockCount = useMemo(
    () => products.filter((p) => isLowStock(p)).length,
    [products],
  )

  const activeGramProduct = useMemo(
    () => products.find((p) => p.id === saleGramsProductId) ?? null,
    [products, saleGramsProductId],
  )

  const fractionalPreview = useMemo(() => {
    const p = activeGramProduct
    if (!p) return null
    const raw = String(gramsInput).replace(',', '.').trim()
    if (!raw) {
      return {
        grams: null,
        subtotal: null,
        error: null,
        canSubmit: false,
      }
    }
    const grams = Number(raw)
    if (!Number.isFinite(grams) || grams <= 0) {
      return {
        grams: null,
        subtotal: null,
        error: 'Ingresá un peso válido en gramos.',
        canSubmit: false,
      }
    }
    const whole = Math.floor(grams)
    if (whole < 1) {
      return {
        grams: null,
        subtotal: null,
        error: 'Mínimo 1 g.',
        canSubmit: false,
      }
    }
    if (whole > p.stock) {
      return {
        grams: whole,
        subtotal: null,
        error: `No hay stock suficiente (máx. ${p.stock.toLocaleString('es-AR')} g).`,
        canSubmit: false,
      }
    }
    const subtotal = (whole / 1000) * p.priceSale
    return { grams: whole, subtotal, error: null, canSubmit: true }
  }, [activeGramProduct, gramsInput])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_PRODUCTS_KEY, JSON.stringify(products))
    } catch {
      /* ignore quota / private mode */
    }
  }, [products])

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_SALES_KEY,
        JSON.stringify({
          date: getTodayKey(),
          total: dailySales,
          transactions: saleTransactions,
        }),
      )
    } catch {
      /* ignore */
    }
  }, [dailySales, saleTransactions])

  useEffect(() => {
    if (toast == null) return
    const t = window.setTimeout(() => setToast(null), 3800)
    return () => window.clearTimeout(t)
  }, [toast])

  const showSaleToast = useCallback((name, amountArs) => {
    setToast(`Venta exitosa: ${name} - ${formatArs(amountArs)}`)
  }, [])

  const DIGIT_GAP_MS = 135
  const SCAN_IDLE_FLUSH_MS = 95
  const MIN_CODE_LEN = 4

  const handleScanCode = useCallback(
    (raw) => {
      const digits = String(raw ?? '').replace(/\D/g, '')
      if (digits.length < MIN_CODE_LEN) return
      if (
        showAddForm ||
        saleGramsProductId ||
        editingProductId ||
        deleteConfirm ||
        barcodeCameraTarget
      ) {
        return
      }

      const p = products.find((x) => x.barcode === digits)
      if (!p) {
        setScannerFeed({ tone: 'err', text: `Sin coincidencia · ${digits}` })
        window.setTimeout(() => setScannerFeed(null), 3200)
        return
      }
      if (p.stock < 1) {
        setScannerFeed({ tone: 'err', text: `${p.name} · sin stock` })
        window.setTimeout(() => setScannerFeed(null), 3200)
        return
      }

      setScannerFeed({ tone: 'ok', text: `${digits} → ${p.name}` })
      window.setTimeout(() => setScannerFeed(null), 2200)
      setIsScanning(false)

      if (p.isLooseFood) {
        setSaleGramsProductId(p.id)
        setGramsInput('')
      } else {
        const revenue = p.priceSale
        const pid = p.id
        setProducts((prev) =>
          prev.map((item) => {
            if (item.id !== pid) return item
            if (item.isLooseFood || item.stock < 1) return item
            return { ...item, stock: item.stock - 1 }
          }),
        )
        setDailySales((sum) => sum + revenue)
        setSaleTransactions((n) => n + 1)
        showSaleToast(p.name, revenue)
      }
    },
    [
      products,
      showAddForm,
      saleGramsProductId,
      showSaleToast,
      editingProductId,
      deleteConfirm,
      barcodeCameraTarget,
    ],
  )

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)')
    function sync() {
      setShowF1Hint(mq.matches)
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    function onF1(e) {
      if (e.key !== 'F1') return
      if (
        showAddForm ||
        saleGramsProductId ||
        editingProductId ||
        deleteConfirm ||
        barcodeCameraTarget
      ) {
        e.preventDefault()
        return
      }
      e.preventDefault()
      setIsScanning(true)
      window.requestAnimationFrame(() => {
        productSearchRef.current?.focus()
        productSearchRef.current?.select?.()
      })
    }
    window.addEventListener('keydown', onF1, true)
    return () => window.removeEventListener('keydown', onF1, true)
  }, [
    showAddForm,
    saleGramsProductId,
    editingProductId,
    deleteConfirm,
    barcodeCameraTarget,
  ])

  useEffect(() => {
    function onEsc(e) {
      if (e.key !== 'Escape') return
      if (barcodeCameraTarget) {
        setBarcodeCameraTarget(null)
        return
      }
      if (deleteConfirm) {
        setDeleteConfirm(null)
        return
      }
      if (editingProductId) {
        setEditingProductId(null)
        return
      }
      setIsScanning(false)
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [barcodeCameraTarget, deleteConfirm, editingProductId])

  useEffect(() => {
    if (!barcodeCameraTarget) return undefined

    const target = barcodeCameraTarget
    let alive = true
    const scannerRef = { current: null }

    ;(async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import(
          'html5-qrcode',
        )
        if (!alive) return
        const html5 = new Html5Qrcode('kalova-barcode-reader', false)
        scannerRef.current = html5
        const formats = [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.QR_CODE,
        ]
        await html5.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 280, height: 160 },
            formatsToSupport: formats,
          },
          (decodedText) => {
            if (!alive) return
            alive = false
            const h = scannerRef.current
            scannerRef.current = null
            playScanBeep()
            const raw = String(decodedText).trim()
            const digits = raw.replace(/\D/g, '')
            const value = digits || raw
            if (target === 'search') setQuery(value)
            if (target === 'new-product') {
              setForm((f) => ({
                ...f,
                barcode: digits || raw.replace(/\D/g, ''),
              }))
            }
            if (h) {
              void h
                .stop()
                .then(() => h.clear())
                .catch(() => {})
                .finally(() => setBarcodeCameraTarget(null))
            } else {
              setBarcodeCameraTarget(null)
            }
          },
          () => {},
        )
      } catch {
        if (alive) {
          setToast('No se pudo abrir la cámara.')
          setBarcodeCameraTarget(null)
        }
      }
    })()

    return () => {
      alive = false
      const h = scannerRef.current
      scannerRef.current = null
      if (h)
        void h
          .stop()
          .then(() => h.clear())
          .catch(() => {})
    }
  }, [barcodeCameraTarget])

  useEffect(() => {
    return () => {
      if (searchScanTimerRef.current)
        window.clearTimeout(searchScanTimerRef.current)
    }
  }, [])

  function onProductSearchKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (searchScanTimerRef.current) {
        window.clearTimeout(searchScanTimerRef.current)
        searchScanTimerRef.current = null
      }
      const buf = searchScanBufRef.current
      searchScanBufRef.current = ''
      let code = buf
      if (code.length < MIN_CODE_LEN) {
        code = query.replace(/\D/g, '')
      }
      if (code.length >= MIN_CODE_LEN) {
        handleScanCode(code)
        setQuery('')
      }
      return
    }
    if (!/^\d$/.test(e.key)) {
      searchScanBufRef.current = ''
      lastSearchDigitAtRef.current = 0
      if (searchScanTimerRef.current) {
        window.clearTimeout(searchScanTimerRef.current)
        searchScanTimerRef.current = null
      }
      return
    }
    const now = Date.now()
    if (now - lastSearchDigitAtRef.current > DIGIT_GAP_MS) {
      searchScanBufRef.current = ''
    }
    lastSearchDigitAtRef.current = now
    searchScanBufRef.current += e.key
    if (searchScanTimerRef.current) {
      window.clearTimeout(searchScanTimerRef.current)
    }
    searchScanTimerRef.current = window.setTimeout(() => {
      searchScanTimerRef.current = null
      const b = searchScanBufRef.current
      searchScanBufRef.current = ''
      if (b.length >= MIN_CODE_LEN) {
        handleScanCode(b)
        setQuery('')
      }
    }, SCAN_IDLE_FLUSH_MS)
  }

  function sellUnit(productId) {
    const p = products.find((x) => x.id === productId)
    if (!p || p.isLooseFood || p.stock < 1) return
    const revenue = p.priceSale
    setProducts((prev) =>
      prev.map((item) => {
        if (item.id !== productId) return item
        if (item.isLooseFood) return item
        if (item.stock < 1) return item
        return { ...item, stock: item.stock - 1 }
      }),
    )
    setDailySales((sum) => sum + revenue)
    setSaleTransactions((n) => n + 1)
    showSaleToast(p.name, revenue)
  }

  function openLooseSale(productId) {
    setSaleGramsProductId(productId)
    setGramsInput('')
  }

  function confirmLooseSale() {
    const p = activeGramProduct
    if (!p || !p.isLooseFood || !fractionalPreview?.canSubmit) return
    const whole = fractionalPreview.grams
    const revenue = fractionalPreview.subtotal
    setProducts((prev) =>
      prev.map((item) =>
        item.id === p.id ? { ...item, stock: item.stock - whole } : item,
      ),
    )
    setDailySales((sum) => sum + revenue)
    setSaleTransactions((n) => n + 1)
    showSaleToast(p.name, revenue)
    setSaleGramsProductId(null)
    setGramsInput('')
  }

  function handleAddProduct(e) {
    e.preventDefault()
    const name = form.name.trim()
    const category = form.category.trim()
    const stock = Number(String(form.stock).replace(',', '.'))
    const priceSale = Number(String(form.priceSale).replace(',', '.'))
    if (!name || !category || !Number.isFinite(stock) || stock < 0) return
    if (!Number.isFinite(priceSale) || priceSale < 0) return
    const stockInt = Math.floor(stock)
    const barcodeRaw = form.barcode.trim().replace(/\D/g, '')
    const barcode =
      barcodeRaw ||
      `780${String(Date.now()).slice(-10)}${String(products.length)}`
    if (products.some((x) => x.barcode === barcode)) {
      setToast('Ya existe un producto con ese código de barras.')
      return
    }
    setProducts((prev) => [
      ...prev,
      createProduct({
        name,
        category,
        stock: stockInt,
        priceSale,
        isLooseFood: form.isLooseFood,
        barcode,
      }),
    ])
    setForm({
      name: '',
      category: '',
      stock: '',
      priceSale: '',
      barcode: '',
      isLooseFood: false,
    })
    setShowAddForm(false)
  }

  function abrirEdicionProducto(p) {
    setEditingProductId(p.id)
    setEditForm({
      name: p.name,
      category: p.category,
      stock: String(p.stock),
      priceSale: String(p.priceSale),
      barcode: p.barcode,
      isLooseFood: p.isLooseFood,
    })
  }

  function editarProducto(e) {
    e.preventDefault()
    if (!editingProductId) return
    const name = editForm.name.trim()
    const category = editForm.category.trim()
    const stock = Number(String(editForm.stock).replace(',', '.'))
    const priceSale = Number(String(editForm.priceSale).replace(',', '.'))
    if (!name || !category || !Number.isFinite(stock) || stock < 0) return
    if (!Number.isFinite(priceSale) || priceSale < 0) return
    const stockInt = Math.floor(stock)
    const barcodeRaw = editForm.barcode.trim().replace(/\D/g, '')
    const barcode =
      barcodeRaw ||
      `780${String(Date.now()).slice(-10)}${String(products.length)}`
    if (
      products.some(
        (x) => x.barcode === barcode && x.id !== editingProductId,
      )
    ) {
      setToast('Ya existe otro producto con ese código de barras.')
      return
    }
    setProducts((prev) =>
      prev.map((item) =>
        item.id === editingProductId
          ? {
              ...item,
              name,
              category,
              stock: stockInt,
              priceSale,
              isLooseFood: editForm.isLooseFood,
              barcode,
            }
          : item,
      ),
    )
    setEditingProductId(null)
    setToast('Producto actualizado.')
  }

  function eliminarProducto() {
    const t = deleteConfirm
    if (!t) return
    setProducts((prev) => prev.filter((x) => x.id !== t.id))
    setDeleteConfirm(null)
    setToast(`Eliminado: ${t.name}`)
  }

  const todayLongLabel = useMemo(
    () =>
      new Date().toLocaleDateString('es-AR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    [],
  )

  function handleLogoNavClick() {
    window.location.reload()
  }

  function handleCierreCaja() {
    const now = new Date().toLocaleString('es-AR')
    const lines = [
      '══════════════════════════════════════',
      '  CIERRE DE CAJA — Pet Shop',
      '══════════════════════════════════════',
      '',
      `Generado: ${now}`,
      `Fecha operativa: ${getTodayKey()}`,
      '',
      '── Resumen financiero ──',
      `Recaudación total del día: ${formatArs(dailySales)}`,
      `Operaciones registradas: ${saleTransactions}`,
      '',
      '── Inventario (snapshot) ──',
      'Nombre | Categoría | EAN | Stock | Precio venta',
      ...products.map((p) => {
        const st = p.isLooseFood ? `${p.stock} g` : `${p.stock} u.`
        const price = p.isLooseFood
          ? `${formatArs(p.priceSale)}/kg`
          : formatArs(p.priceSale)
        return `${p.name} | ${p.category} | ${p.barcode} | ${st} | ${price}`
      }),
      '',
      '── Fin del reporte ──',
    ]
    downloadTextFile(`cierre-caja-${getTodayKey()}.txt`, lines.join('\n'))
    setToast('Cierre de caja exportado: revisá tu carpeta de descargas.')
  }

  return (
    <div className="min-h-screen bg-[#1a1a1c] text-zinc-100">
      <nav
        className="sticky top-0 z-40 border-b border-red-900/50 bg-gradient-to-r from-[#ff003c]/[0.08] via-[#121214]/60 to-[#1a1a1c]/90 shadow-[0_8px_32px_rgb(0_0_0_/0.35)] backdrop-blur-xl backdrop-saturate-150"
        aria-label="Navegación principal KaloVa"
      >
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={handleLogoNavClick}
            className="group flex shrink-0 items-center rounded-xl p-1.5 ring-white/0 transition hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff003c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1a1c]"
            aria-label="KaloVa: volver al inicio y actualizar"
          >
            <img
              src={logoKalova}
              alt="KaloVa"
              className="h-16 w-auto max-w-[min(100%,220px)] object-contain object-left drop-shadow-[0_0_14px_rgb(255_255_255_/0.18)] transition group-hover:opacity-95"
              decoding="async"
            />
          </button>
          <div className="hidden h-12 w-px shrink-0 bg-gradient-to-b from-transparent via-white/35 to-transparent sm:block" />
          <div className="min-w-0 flex-1 sm:py-0.5">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/95">
              KaloVa ·{' '}
              <span className="text-[#ff003c] drop-shadow-[0_0_12px_rgb(255_0_60_/0.55)]">
                POS
              </span>
            </p>
            <h1 className="truncate text-base font-extrabold text-white sm:text-lg">
              Pet Shop — War Room
            </h1>
          </div>
        </div>
      </nav>

      <header className="mx-auto max-w-5xl px-4 pb-2 pt-6 sm:px-6 lg:px-8">
        <p className="max-w-xl text-sm font-medium leading-relaxed text-gray-400">
          <span className="hidden sm:inline">
            Centro de comando: ventas, escáner por código (F1 en búsqueda),
            lector con cámara en móvil y stock crítico en alerta roja.
          </span>
          <span className="sm:hidden">
            Ventas e inventario táctico: escaneá con la cámara o buscá por
            nombre. Granel abre el módulo de peso.
          </span>
        </p>
      </header>

      <div className="mx-auto max-w-5xl px-4 pb-8 sm:px-6 lg:px-8">
        <section
          className="mb-8 rounded-2xl border border-red-900/50 bg-[#121214] p-5 shadow-[0_0_40px_rgb(0_0_0_/0.35),inset_0_1px_0_rgb(255_255_255_/0.04)] sm:p-6"
          aria-label="Dashboard de ventas del día"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-[11px] font-extrabold uppercase tracking-[0.28em] text-[#ff003c]">
                Dashboard de Ventas
              </h2>
              <p className="mt-1 capitalize text-sm font-medium text-gray-400">
                Turno hoy · {todayLongLabel}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCierreCaja}
                className="rounded-xl border-2 border-white bg-transparent px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-white/10"
              >
                Cierre de Caja
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="rounded-xl bg-[#ff003c] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-white shadow-[0_0_28px_rgb(255_0_60_/0.45)] transition hover:brightness-110"
              >
                Nuevo Producto
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-red-900/50 bg-[#121214] p-4 lg:col-span-2 lg:p-5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Total recaudado hoy
              </p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight text-white sm:text-3xl">
                {formatArs(dailySales)}
              </p>
              <p className="mt-2 text-xs font-medium text-gray-400">
                Caja diaria · ARS
              </p>
            </div>
            <div className="rounded-xl border border-red-900/50 bg-[#121214] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Operaciones
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-[#ff003c] [text-shadow:0_0_18px_rgb(255_0_60_/0.45)]">
                {saleTransactions}
              </p>
              <p className="mt-1 text-xs text-gray-400">Ventas registradas</p>
            </div>
            <div className="rounded-xl border border-red-900/50 bg-[#121214] p-4 shadow-[inset_0_0_0_1px_rgb(255_0_60_/0.18)]">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#ff003c]">
                Alertas stock
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-stock-alert">
                {lowStockCount}
              </p>
              <p className="mt-1 text-xs text-gray-400">
                Ítems bajo umbral
              </p>
            </div>
          </div>
        </section>

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex w-full gap-2 sm:max-w-md">
            <div className="relative min-w-0 flex-1">
              <span
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                aria-hidden
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </span>
              <input
                ref={productSearchRef}
                id="product-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onProductSearchKeyDown}
                onBlur={() => setIsScanning(false)}
                placeholder={
                  showF1Hint
                    ? 'Buscar por nombre o escanear código (F1)…'
                    : 'Buscar por nombre o código de barras…'
                }
                autoComplete="off"
                aria-label="Código de barras o búsqueda"
                className="w-full rounded-xl border border-red-900/50 bg-[#121214] py-2.5 pl-10 pr-3 text-sm font-medium text-white placeholder:text-gray-500 outline-none ring-[#ff003c]/25 transition focus:border-[#ff003c]/40 focus:ring-2"
              />
            </div>
            <button
              type="button"
              onClick={() => setBarcodeCameraTarget('search')}
              disabled={
                !!barcodeCameraTarget ||
                showAddForm ||
                editingProductId ||
                saleGramsProductId
              }
              className="flex h-[42px] w-11 shrink-0 items-center justify-center rounded-xl border-2 border-[#ff003c] bg-[#121214] text-[#ff003c] shadow-[0_0_16px_rgb(255_0_60_/0.25)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Escanear código con la cámara"
              title="Cámara"
            >
              <CameraIcon className="h-5 w-5" />
            </button>
          </div>
          <p className="text-xs text-gray-400">
            {filtered.length} producto
            {filtered.length !== 1 ? 's' : ''} visible
            {query.trim() ? ` · «${query.trim()}»` : ''}
          </p>
        </div>

        <div
          className={`mb-4 rounded-lg border bg-[#121214] px-3 py-2 shadow-[inset_0_1px_0_rgb(255_0_60_/0.12)] ${
            isScanning
              ? 'border-scan-pulse border-red-900/50'
              : 'border-red-900/50'
          }`}
          aria-label="Modo escáner de códigos"
        >
          <div className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#ff003c]/35 bg-[#ff003c]/12 text-[#ff003c]"
              aria-hidden
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.75}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 6h2m3 0h1m3 0h1m3 0h2M4 12h1m2 0h2m2 0h4m2 0h1M4 18h2m3 0h4m3 0h2M6 6v12m12-12v12M9 6v12m6-12v12"
                />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#ff003c]">
                {showF1Hint
                  ? 'MODO ESCÁNER ACTIVO (Presiona F1 para buscar por código)'
                  : 'MODO ESCÁNER — Cámara junto al campo o escribí el código'}
              </p>
              {scannerFeed && (
                <p
                  className={`mt-1 truncate text-xs font-medium ${
                    scannerFeed.tone === 'err'
                      ? 'text-stock-alert'
                      : 'text-[#ff003c]'
                  }`}
                >
                  {scannerFeed.text}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-red-900/50 bg-[#121214] shadow-[0_0_32px_rgb(0_0_0_/0.25)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/5 bg-[#121214]/95 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  <th className="px-4 py-3.5">Nombre</th>
                  <th className="px-4 py-3.5">Categoría</th>
                  <th className="px-4 py-3.5 text-right">Stock</th>
                  <th className="px-4 py-3.5 text-right">Precio venta</th>
                  <th className="px-4 py-3.5 text-right">Venta</th>
                  <th className="px-4 py-3.5 text-right">Gestión</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-14 text-center text-gray-400"
                    >
                      {products.length === 0
                        ? 'No hay productos cargados. Usá «Nuevo producto» para comenzar.'
                        : query.trim()
                          ? `No hay coincidencias para «${query.trim()}».`
                          : 'Sin resultados.'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((p) => {
                    const low = isLowStock(p)
                    const neonStock =
                      'tabular-nums font-bold ' +
                      (low
                        ? 'text-stock-alert'
                        : 'text-[#ff003c] [text-shadow:0_0_14px_rgb(255_0_60_/0.4)]')
                    return (
                      <tr
                        key={p.id}
                        className="border-b border-white/[0.06] transition-colors hover:bg-[rgba(255,0,60,0.06)]"
                      >
                        <td className="px-4 py-3.5 font-medium text-zinc-100">
                          {p.name}
                          {p.isLooseFood && (
                            <span className="ml-2 rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide text-gray-400">
                              Granel
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-gray-400">
                          {p.category}
                        </td>
                        <td className={`px-4 py-3.5 text-right ${neonStock}`}>
                          {stockLabel(p)}
                        </td>
                        <td className="px-4 py-3.5 text-right tabular-nums text-zinc-300">
                          {formatArs(p.priceSale)}
                          {p.isLooseFood && (
                            <span className="ml-1 text-[10px] text-gray-400">
                              /kg
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <button
                            type="button"
                            disabled={p.stock < 1}
                            onClick={() =>
                              p.isLooseFood
                                ? openLooseSale(p.id)
                                : sellUnit(p.id)
                            }
                            className="rounded-lg bg-[#ff003c] px-3 py-1.5 text-xs font-semibold text-white shadow-[0_0_18px_rgb(255_0_60_/0.45)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Venta
                          </button>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <div className="flex justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => abrirEdicionProducto(p)}
                              className="rounded-lg border border-white/10 bg-[#1a1a1c] p-2 text-zinc-400 transition hover:border-[#ff003c]/40 hover:text-[#ff003c]"
                              aria-label={`Editar ${p.name}`}
                              title="Editar"
                            >
                              <svg
                                className="h-4 w-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                                aria-hidden
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setDeleteConfirm({ id: p.id, name: p.name })
                              }
                              className="rounded-lg border border-red-900/50 bg-[#1a1a1c] p-2 text-red-400/90 transition hover:border-[#ff003c]/55 hover:bg-[#ff003c]/10 hover:text-[#ff003c]"
                              aria-label={`Eliminar ${p.name}`}
                              title="Eliminar"
                            >
                              <svg
                                className="h-4 w-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                                aria-hidden
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {toast && (
        <div
          className="pointer-events-none fixed top-24 right-4 z-[100] max-w-[min(100vw-2rem,22rem)] rounded-xl border border-[#ff003c]/35 bg-[#121214]/92 px-4 py-3 shadow-[0_0_32px_rgb(255_0_60_/0.2)] backdrop-blur-xl"
          role="status"
          aria-live="polite"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-[#ff003c]">
            Ticket
          </p>
          <p className="mt-1 text-sm font-medium leading-snug text-white">
            {toast}
          </p>
        </div>
      )}

      {/* Modal: venta fraccionada (peso en gramos) */}
      {activeGramProduct && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
          data-no-scan
          role="dialog"
          aria-modal="true"
          aria-labelledby="fractional-sale-title"
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-red-900/50 bg-[#121214] shadow-[0_0_50px_rgb(0_0_0_/0.45),inset_0_1px_0_rgb(255_255_255_/0.05)]">
            <div className="border-b border-red-900/50 bg-gradient-to-r from-[#ff003c]/10 via-[#121214]/40 to-transparent px-5 py-4 backdrop-blur-sm">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#ff003c]">
                Venta fraccionada
              </p>
              <h2
                id="fractional-sale-title"
                className="mt-1 text-lg font-semibold leading-snug text-white"
              >
                {activeGramProduct.name}
              </h2>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-400">
                <span className="rounded-md border border-white/5 bg-[#121214] px-2 py-1 font-mono text-zinc-300">
                  Stock: {activeGramProduct.stock.toLocaleString('es-AR')} g
                </span>
                <span className="rounded-md border border-white/5 bg-[#121214] px-2 py-1">
                  {formatArs(activeGramProduct.priceSale)}
                  /kg
                </span>
              </div>
            </div>

            <div className="p-5">
              <label
                className="text-xs font-semibold uppercase tracking-wide text-zinc-400"
                htmlFor="fractional-grams"
              >
                Peso vendido (gramos)
              </label>
              <input
                id="fractional-grams"
                type="number"
                inputMode="decimal"
                min={1}
                max={activeGramProduct.stock}
                value={gramsInput}
                onChange={(e) => setGramsInput(e.target.value)}
                placeholder="Ej.: 350"
                autoFocus
                className="mt-2 w-full rounded-xl border border-white/5 bg-[#121214] px-3 py-3 text-lg font-bold tabular-nums text-white outline-none ring-[#ff003c]/25 transition placeholder:text-gray-500 focus:border-[#ff003c]/40 focus:ring-2"
              />
              <p className="mt-2 text-[11px] text-gray-400">
                Se factura por kg: el total se calcula al vuelo según los gramos
                confirmados.
              </p>

              <p className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Atajos
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  { label: '100 g', g: 100 },
                  { label: '250 g', g: 250 },
                  { label: '500 g', g: 500 },
                  { label: '1 kg', g: 1000 },
                ].map((chip) => (
                  <button
                    key={chip.g}
                    type="button"
                    className="rounded-lg border border-white/15 bg-[#121214] px-3 py-1.5 text-xs font-semibold text-gray-300 transition hover:border-[#ff003c]/50 hover:text-[#ff003c]"
                    onClick={() =>
                      setGramsInput(String(Math.min(chip.g, activeGramProduct.stock)))
                    }
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              <div
                className="mt-5 rounded-xl border border-white/5 bg-[#121214] p-4"
                aria-live="polite"
              >
                {fractionalPreview?.error ? (
                  <p className="text-sm font-semibold text-stock-alert">
                    {fractionalPreview.error}
                  </p>
                ) : fractionalPreview?.canSubmit ? (
                  <>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Total estimado
                    </p>
                    <p className="mt-1 text-2xl font-extrabold tabular-nums text-white">
                      {formatArs(fractionalPreview.subtotal)}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {fractionalPreview.grams?.toLocaleString('es-AR')} g ×{' '}
                      {formatArs(activeGramProduct.priceSale)}/kg
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-gray-400">
                    Ingresá el peso en gramos o usá un atajo para ver el total.
                  </p>
                )}
              </div>

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  className="rounded-xl border-2 border-white bg-transparent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
                  onClick={() => {
                    setSaleGramsProductId(null)
                    setGramsInput('')
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!fractionalPreview?.canSubmit}
                  onClick={confirmLooseSale}
                  className="rounded-xl bg-[#ff003c] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_0_24px_rgb(255_0_60_/0.4)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  Registrar venta
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: nuevo producto */}
      {showAddForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
          data-no-scan
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-product-title"
        >
          <form
            onSubmit={handleAddProduct}
            className="w-full max-w-md overflow-hidden rounded-2xl border border-red-900/50 bg-[#121214] shadow-[0_0_50px_rgb(0_0_0_/0.45)]"
          >
            <div className="border-b border-red-900/50 bg-gradient-to-r from-[#ff003c]/12 via-[#121214] to-[#1a1a1c] px-6 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#ff003c]">
                Alta de inventario
              </p>
              <h2
                id="new-product-title"
                className="mt-1 text-lg font-semibold text-white"
              >
                Nuevo producto
              </h2>
              <p className="mt-1 text-xs text-gray-500">
                Los datos se guardan en este dispositivo (localStorage).
              </p>
            </div>
            <div className="grid gap-3 px-6 py-5">
              <div>
                <label className="text-xs text-gray-400">Nombre</label>
                <input
                  required
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-white/5 bg-[#121214] px-3 py-2 text-sm font-medium text-white outline-none ring-[#ff003c]/20 focus:border-[#ff003c]/35 focus:ring-2"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">Categoría</label>
                <input
                  required
                  value={form.category}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, category: e.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-white/5 bg-[#121214] px-3 py-2 text-sm font-medium text-white outline-none ring-[#ff003c]/20 focus:border-[#ff003c]/35 focus:ring-2"
                />
              </div>
              <div>
                <label
                  className="text-xs text-gray-400"
                  htmlFor="new-product-barcode"
                >
                  Código de barras (EAN)
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    id="new-product-barcode"
                    value={form.barcode}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, barcode: e.target.value }))
                    }
                    placeholder="Opcional · numérico"
                    inputMode="numeric"
                    className="min-w-0 flex-1 rounded-xl border border-white/5 bg-[#121214] px-3 py-2 text-sm font-medium text-white outline-none ring-[#ff003c]/20 placeholder:text-gray-600 focus:border-[#ff003c]/35 focus:ring-2"
                  />
                  <button
                    type="button"
                    onClick={() => setBarcodeCameraTarget('new-product')}
                    disabled={!!barcodeCameraTarget}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-[#ff003c] bg-[#1a1a1c] text-[#ff003c] shadow-[0_0_14px_rgb(255_0_60_/0.22)] transition hover:brightness-110 disabled:opacity-40"
                    aria-label="Escanear código con la cámara"
                    title="Cámara"
                  >
                    <CameraIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400">
                    Stock {form.isLooseFood ? '(g)' : '(unidades)'}
                  </label>
                  <input
                    required
                    min={0}
                    type="number"
                    value={form.stock}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, stock: e.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border border-white/5 bg-[#121214] px-3 py-2 text-sm font-medium text-white outline-none ring-[#ff003c]/20 focus:border-[#ff003c]/35 focus:ring-2"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">
                    Precio venta (ARS)
                    {form.isLooseFood && (
                      <span className="font-normal text-gray-500"> /kg</span>
                    )}
                  </label>
                  <input
                    required
                    min={0}
                    type="number"
                    value={form.priceSale}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, priceSale: e.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border border-white/5 bg-[#121214] px-3 py-2 text-sm font-medium text-white outline-none ring-[#ff003c]/20 focus:border-[#ff003c]/35 focus:ring-2"
                  />
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-400">
                <input
                  type="checkbox"
                  checked={form.isLooseFood}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, isLooseFood: e.target.checked }))
                  }
                  className="rounded border-white/20 bg-[#121214] accent-[#ff003c]"
                />
                Alimento suelto (stock en gramos; venta por gramos)
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-white/5 bg-[#1a1a1c]/70 px-6 py-4">
              <button
                type="button"
                className="rounded-lg border-2 border-white/25 bg-transparent px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
                onClick={() => setShowAddForm(false)}
              >
                Cerrar
              </button>
              <button
                type="submit"
                className="rounded-lg bg-[#ff003c] px-4 py-2 text-xs font-semibold text-white shadow-[0_0_20px_rgb(255_0_60_/0.38)] transition hover:brightness-110"
              >
                Guardar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: editar producto */}
      {editingProductId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
          data-no-scan
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-product-title"
        >
          <form
            onSubmit={editarProducto}
            className="w-full max-w-md overflow-hidden rounded-2xl border border-red-900/50 bg-[#121214] shadow-[0_0_55px_rgb(190_0_40_/0.12),0_0_60px_rgb(0_0_0_/0.55)]"
          >
            <div className="border-b border-red-900/50 bg-gradient-to-r from-[#ff003c]/15 via-[#121214] to-[#1a1a1c] px-6 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#ff003c]">
                Edición de producto
              </p>
              <h2
                id="edit-product-title"
                className="mt-1 text-lg font-semibold leading-snug text-white"
              >
                {editForm.name || 'Sin nombre'}
              </h2>
              <p className="mt-1 font-mono text-[11px] text-gray-500">
                ID interno · {editingProductId}
              </p>
            </div>
            <div className="grid gap-3 px-6 py-5">
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  Nombre
                </label>
                <input
                  required
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, name: e.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1a1c] px-3 py-2.5 text-sm font-medium text-white outline-none ring-[#ff003c]/20 transition focus:border-[#ff003c]/45 focus:ring-2"
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  Categoría
                </label>
                <input
                  required
                  value={editForm.category}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, category: e.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1a1c] px-3 py-2.5 text-sm font-medium text-white outline-none ring-[#ff003c]/20 transition focus:border-[#ff003c]/45 focus:ring-2"
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  Código de barras (EAN)
                </label>
                <input
                  value={editForm.barcode}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, barcode: e.target.value }))
                  }
                  placeholder="Numérico"
                  inputMode="numeric"
                  className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1a1c] px-3 py-2.5 text-sm font-medium text-white outline-none ring-[#ff003c]/20 placeholder:text-gray-600 focus:border-[#ff003c]/45 focus:ring-2"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide text-gray-400">
                    Stock {editForm.isLooseFood ? '(g)' : '(u.)'}
                  </label>
                  <input
                    required
                    min={0}
                    type="number"
                    value={editForm.stock}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, stock: e.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1a1c] px-3 py-2.5 text-sm font-medium text-white outline-none ring-[#ff003c]/20 focus:border-[#ff003c]/45 focus:ring-2"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide text-gray-400">
                    Precio venta (ARS)
                    {editForm.isLooseFood && (
                      <span className="font-normal normal-case text-gray-500">
                        {' '}
                        /kg
                      </span>
                    )}
                  </label>
                  <input
                    required
                    min={0}
                    type="number"
                    value={editForm.priceSale}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, priceSale: e.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1a1c] px-3 py-2.5 text-sm font-medium text-white outline-none ring-[#ff003c]/20 focus:border-[#ff003c]/45 focus:ring-2"
                  />
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-400">
                <input
                  type="checkbox"
                  checked={editForm.isLooseFood}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      isLooseFood: e.target.checked,
                    }))
                  }
                  className="rounded border-white/20 bg-[#1a1a1c] accent-[#ff003c]"
                />
                Alimento suelto (stock y venta en gramos)
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-white/5 bg-[#1a1a1c]/80 px-6 py-4">
              <button
                type="button"
                className="rounded-lg border-2 border-white/25 bg-transparent px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
                onClick={() => setEditingProductId(null)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-lg bg-[#ff003c] px-4 py-2 text-xs font-semibold text-white shadow-[0_0_22px_rgb(255_0_60_/0.4)] transition hover:brightness-110"
              >
                Guardar cambios
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: confirmar eliminación */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
          data-no-scan
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-title"
        >
          <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-red-900/50 bg-[#121214] shadow-[0_0_40px_rgb(0_0_0_/0.5)]">
            <div className="border-b border-red-900/50 px-6 py-4">
              <h2
                id="delete-title"
                className="text-base font-semibold text-white"
              >
                ¿Eliminar producto?
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-gray-400">
                Se quitará{' '}
                <span className="font-medium text-zinc-200">
                  {deleteConfirm.name}
                </span>{' '}
                del inventario local. Esta acción no se puede deshacer.
              </p>
            </div>
            <div className="flex justify-end gap-2 bg-[#1a1a1c]/80 px-6 py-4">
              <button
                type="button"
                className="rounded-lg border-2 border-white/25 bg-transparent px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={eliminarProducto}
                className="rounded-lg bg-[#ff003c] px-4 py-2 text-xs font-semibold text-white shadow-[0_0_20px_rgb(255_0_60_/0.35)] transition hover:brightness-110"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Visor mínimo: solo video (Html5Qrcode) */}
      {barcodeCameraTarget && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          data-no-scan
          role="dialog"
          aria-modal="true"
          aria-labelledby="barcode-viewer-title"
          onClick={() => setBarcodeCameraTarget(null)}
        >
          <div
            className="relative w-full max-w-sm overflow-hidden rounded-xl border-2 border-[#ff003c] bg-black shadow-[0_0_28px_rgb(255_0_60_/0.45),0_0_60px_rgb(255_0_60_/0.15)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-red-900/60 bg-[#121214] px-3 py-2">
              <h2
                id="barcode-viewer-title"
                className="text-xs font-semibold uppercase tracking-wide text-[#ff003c]"
              >
                Cámara · códigos
              </h2>
              <button
                type="button"
                onClick={() => setBarcodeCameraTarget(null)}
                className="rounded-md border border-white/20 px-2 py-1 text-xs text-gray-300 hover:border-[#ff003c]/50 hover:text-white"
              >
                Cerrar
              </button>
            </div>
            <div
              id="kalova-barcode-reader"
              className="min-h-[220px] w-full [&_video]:max-h-[50vh] [&_video]:w-full [&_video]:object-cover"
            />
          </div>
        </div>
      )}
    </div>
  )
}
