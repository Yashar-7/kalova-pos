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

const STORAGE_PRODUCTS_KEY = 'pet-shop:inventory-v1'
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
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    let autoBarcode = 779_000_000_000_1
    const list = parsed
      .map(normalizeProduct)
      .filter(Boolean)
      .map((item) => {
        if (item.barcode && item.barcode.length >= 4) return item
        const b = String(autoBarcode++)
        return { ...item, barcode: b }
      })
    return list.length > 0 ? list : null
  } catch {
    return null
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

function getDefaultProducts() {
  return [
    createProduct({
      name: 'Pro Plan Adulto 15kg',
      category: 'Alimento para perros',
      stock: 8,
      priceSale: 189500,
      barcode: '7790123456001',
    }),
    createProduct({
      name: 'Royal Canin Gato 3kg',
      category: 'Alimento para gatos',
      stock: 4,
      priceSale: 98500,
      barcode: '7790123456002',
    }),
    createProduct({
      name: 'Pipeta Frontline',
      category: 'Antiparasitarios',
      stock: 22,
      priceSale: 28500,
      barcode: '7790123456003',
    }),
    createProduct({
      name: 'Mordillo Soga',
      category: 'Juguetes',
      stock: 15,
      priceSale: 12500,
      barcode: '7790123456004',
    }),
    createProduct({
      name: 'Bolsa Alimento Suelto',
      category: 'Alimento suelto',
      stock: 18500,
      priceSale: 6900,
      isLooseFood: true,
      barcode: '7790123456005',
    }),
  ]
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

export default function App() {
  const savedSales = loadPersistedSalesState()
  const [products, setProducts] = useState(
    () => loadPersistedProducts() ?? getDefaultProducts(),
  )
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
      if (showAddForm || saleGramsProductId) return

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
    [products, showAddForm, saleGramsProductId, showSaleToast],
  )

  useEffect(() => {
    function onF1(e) {
      if (e.key !== 'F1') return
      if (showAddForm || saleGramsProductId) {
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
  }, [showAddForm, saleGramsProductId])

  useEffect(() => {
    function onEsc(e) {
      if (e.key !== 'Escape') return
      setIsScanning(false)
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [])

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
          Centro de comando: ventas, escáner por código (F1 en búsqueda) y
          stock crítico en alerta roja. Granel abre el módulo de peso.
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

        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-md">
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
              placeholder="Buscar por nombre o escanear código (F1)…"
              autoComplete="off"
              className="w-full rounded-xl border border-red-900/50 bg-[#121214] py-2.5 pl-10 pr-4 text-sm font-medium text-white placeholder:text-gray-500 outline-none ring-[#ff003c]/25 transition focus:border-[#ff003c]/40 focus:ring-2"
            />
          </div>
          <p className="text-xs text-gray-400">
            {filtered.length} producto
            {filtered.length !== 1 ? 's' : ''} visible
            {query.trim() ? ` · filtro «${query.trim()}»` : ''}
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
                MODO ESCÁNER ACTIVO (Presiona F1 para buscar por código)
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
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/5 bg-[#121214]/95 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  <th className="px-4 py-3.5">Nombre</th>
                  <th className="px-4 py-3.5">Categoría</th>
                  <th className="px-4 py-3.5 text-right">Stock</th>
                  <th className="px-4 py-3.5 text-right">Precio venta</th>
                  <th className="px-4 py-3.5 text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-14 text-center text-gray-400"
                    >
                      No hay coincidencias para «{query.trim()}».
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          data-no-scan
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-product-title"
        >
          <form
            onSubmit={handleAddProduct}
            className="w-full max-w-md rounded-2xl border border-red-900/50 bg-[#121214] p-6 shadow-[0_0_40px_rgb(0_0_0_/0.4)]"
          >
            <h2
              id="new-product-title"
              className="text-lg font-semibold text-white"
            >
              Nuevo producto
            </h2>
            <div className="mt-4 grid gap-3">
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
                <label className="text-xs text-gray-400">
                  Código de barras (EAN)
                </label>
                <input
                  value={form.barcode}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, barcode: e.target.value }))
                  }
                  placeholder="Opcional · numérico"
                  inputMode="numeric"
                  className="mt-1 w-full rounded-xl border border-white/5 bg-[#121214] px-3 py-2 text-sm font-medium text-white outline-none ring-[#ff003c]/20 placeholder:text-gray-600 focus:border-[#ff003c]/35 focus:ring-2"
                />
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
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border-2 border-white bg-transparent px-3 py-2 text-xs font-semibold text-white hover:bg-white/10"
                onClick={() => setShowAddForm(false)}
              >
                Cerrar
              </button>
              <button
                type="submit"
                className="rounded-lg bg-[#ff003c] px-3 py-2 text-xs font-semibold text-white shadow-[0_0_20px_rgb(255_0_60_/0.38)] hover:brightness-110"
              >
                Guardar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
