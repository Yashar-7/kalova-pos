import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import logoKalova from './assets/logo-kalova.png'

let idSeq = 0
function newId() {
  idSeq += 1
  return `p-${Date.now()}-${idSeq}`
}

function newCartLineId() {
  idSeq += 1
  return `c-${Date.now()}-${idSeq}`
}

/** Stock en unidades; si `isLooseFood`, stock = gramos. Costo y venta: ARS (venta $/kg si granel). */
function createProduct({
  name,
  category = 'General',
  stock,
  priceSale,
  priceCost = 0,
  isLooseFood = false,
  barcode = '',
}) {
  const bc = String(barcode).replace(/\D/g, '')
  return {
    id: newId(),
    name,
    category: String(category),
    stock: Number(stock),
    priceSale: Number(priceSale),
    priceCost: Math.max(0, Number(priceCost) || 0),
    isLooseFood,
    barcode: bc,
  }
}

const STORAGE_PRODUCTS_KEY = 'pet-shop:inventory-v2'
const STORAGE_CAJA_KEY = 'pet-shop:caja-v1'

const PAYMENT_METHODS = [
  { key: 'efectivo', label: 'Efectivo', bg: '#ff003c' },
  { key: 'tarjeta', label: 'Tarjeta', bg: '#0ea5e9' },
  { key: 'qr', label: 'QR / MP', bg: '#a855f7' },
  { key: 'transferencia', label: 'Transf.', bg: '#f97316' },
]

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
    category: String(p.category ?? 'General') || 'General',
    stock: Math.max(0, Math.floor(Number(p.stock) || 0)),
    priceSale: Math.max(0, Number(p.priceSale) || 0),
    priceCost: Math.max(0, Number(p.priceCost) || 0),
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

function defaultCajaState(date) {
  return {
    date,
    total: 0,
    transactions: 0,
    byMethod: { efectivo: 0, tarjeta: 0, qr: 0, transferencia: 0 },
    sales: [],
    expenses: [],
  }
}

function loadCajaState() {
  const today = getTodayKey()
  try {
    const raw = localStorage.getItem(STORAGE_CAJA_KEY)
    if (!raw) return defaultCajaState(today)
    const d = JSON.parse(raw)
    if (d?.date !== today) return defaultCajaState(today)
    return {
      date: today,
      total: Math.max(0, Number(d.total) || 0),
      transactions: Math.max(0, Math.floor(Number(d.transactions) || 0)),
      byMethod: {
        efectivo: Math.max(0, Number(d.byMethod?.efectivo) || 0),
        tarjeta: Math.max(0, Number(d.byMethod?.tarjeta) || 0),
        qr: Math.max(0, Number(d.byMethod?.qr) || 0),
        transferencia: Math.max(0, Number(d.byMethod?.transferencia) || 0),
      },
      sales: Array.isArray(d.sales) ? d.sales : [],
      expenses: Array.isArray(d.expenses) ? d.expenses : [],
    }
  } catch {
    return defaultCajaState(today)
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
    return `${p.stock.toLocaleString('es-AR')} g`
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

function downloadCsv(filename, csv) {
  const bom = '\ufeff'
  const blob = new Blob([bom + csv], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

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
    /* no audio */
  }
}

/** Doble tono tipo caja registradora al cerrar venta. */
function playCajaRegistradoraBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const play = (freq, delaySec, dur) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.connect(g)
      g.connect(ctx.destination)
      o.type = 'square'
      o.frequency.value = freq
      const t = ctx.currentTime + delaySec
      g.gain.setValueAtTime(0.1, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + dur)
      o.start(t)
      o.stop(t + dur)
    }
    play(1560, 0, 0.05)
    play(1180, 0.08, 0.08)
    setTimeout(() => void ctx.close(), 350)
  } catch {
    playScanBeep()
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

const MIN_CODE_LEN = 4

export default function App() {
  const [products, setProducts] = useState(() => loadPersistedProducts())
  const [caja, setCaja] = useState(() => loadCajaState())
  const [mainTab, setMainTab] = useState('venta')
  const [toast, setToast] = useState(null)
  const [query, setQuery] = useState('')
  const [isScanning, setIsScanning] = useState(false)
  const [cart, setCart] = useState([])
  const [pagaCon, setPagaCon] = useState('')
  const [barcodeCameraTarget, setBarcodeCameraTarget] = useState(null)
  const [showF1Hint, setShowF1Hint] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(min-width: 640px)').matches
      : true,
  )

  const [cartLooseProductId, setCartLooseProductId] = useState(null)
  const [gramsInput, setGramsInput] = useState('')

  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [expenseModal, setExpenseModal] = useState(false)
  const [expenseForm, setExpenseForm] = useState({ amount: '', note: '' })

  /** Formulario ABM en panel administración */
  const [adminForm, setAdminForm] = useState({
    barcode: '',
    name: '',
    priceCost: '',
    priceSale: '',
    stock: '',
    category: 'General',
    isLooseFood: false,
  })
  const [editingProductId, setEditingProductId] = useState(null)

  const productSearchRef = useRef(null)
  const searchScanBufRef = useRef('')
  const searchScanTimerRef = useRef(null)
  const lastSearchDigitAtRef = useRef(0)
  const [scannerFeed, setScannerFeed] = useState(null)

  const DIGIT_GAP_MS = 135
  const SCAN_IDLE_FLUSH_MS = 95

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return products
    if (/^\d{4,}$/.test(q)) return products
    return products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
  }, [products, query])

  const cartLooseProduct = useMemo(
    () => products.find((p) => p.id === cartLooseProductId) ?? null,
    [products, cartLooseProductId],
  )

  const cartTotal = useMemo(
    () => cart.reduce((s, l) => s + l.lineTotal, 0),
    [cart],
  )

  const pagaNum = Number(String(pagaCon).replace(',', '.'))
  const vuelto =
    mainTab === 'venta' &&
    Number.isFinite(pagaNum) &&
    pagaNum >= cartTotal
      ? pagaNum - cartTotal
      : 0

  const lowStockCount = useMemo(
    () => products.filter((p) => isLowStock(p)).length,
    [products],
  )

  const profitToday = useMemo(() => {
    let m = 0
    for (const s of caja.sales) {
      for (const it of s.items || []) {
        const cost = Number(it.unitCost) || 0
        const qty = Number(it.qty) || 0
        const grams = Number(it.grams) || 0
        if (grams > 0) {
          m += (grams / 1000) * (Number(it.unitPrice) - cost)
        } else {
          m += qty * (Number(it.unitPrice) - cost)
        }
      }
    }
    return m
  }, [caja.sales])

  const expensesTotal = useMemo(
    () =>
      caja.expenses.reduce((a, e) => a + (Number(e.amount) || 0), 0),
    [caja.expenses],
  )

  const netBalance = caja.total - expensesTotal

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

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_PRODUCTS_KEY, JSON.stringify(products))
    } catch {
      /* ignore */
    }
  }, [products])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_CAJA_KEY, JSON.stringify(caja))
    } catch {
      /* ignore */
    }
  }, [caja])

  useEffect(() => {
    if (toast == null) return
    const t = window.setTimeout(() => setToast(null), 3800)
    return () => window.clearTimeout(t)
  }, [toast])

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
    return () => {
      if (searchScanTimerRef.current)
        window.clearTimeout(searchScanTimerRef.current)
    }
  }, [])

  const addLineToCart = useCallback((p, opts) => {
    const { qty = 1, grams = 0 } = opts || {}
    if (!p || p.stock < 1) return

    if (p.isLooseFood) {
      const g = Math.floor(grams)
      if (g < 1 || g > p.stock) return
      const lineTotal = (g / 1000) * p.priceSale
      setCart((prev) => {
        const idx = prev.findIndex(
          (l) => l.productId === p.id && l.isLooseFood,
        )
        if (idx >= 0) {
          const next = [...prev]
          const cur = next[idx]
          const newG = cur.grams + g
          if (newG > p.stock) return prev
          next[idx] = {
            ...cur,
            grams: newG,
            lineTotal: (newG / 1000) * p.priceSale,
          }
          return next
        }
        return [
          ...prev,
          {
            key: newCartLineId(),
            productId: p.id,
            name: p.name,
            barcode: p.barcode,
            isLooseFood: true,
            qty: 0,
            grams: g,
            unitPrice: p.priceSale,
            unitCost: p.priceCost,
            lineTotal,
          },
        ]
      })
      playScanBeep()
      setScannerFeed({ tone: 'ok', text: `${g} g → ${p.name}` })
      window.setTimeout(() => setScannerFeed(null), 1600)
      return
    }

    const q = Math.min(Math.max(1, Math.floor(qty)), p.stock)
    setCart((prev) => {
      const idx = prev.findIndex(
        (l) => l.productId === p.id && !l.isLooseFood,
      )
      if (idx >= 0) {
        const next = [...prev]
        const cur = next[idx]
        const nq = cur.qty + q
        if (nq > p.stock) return prev
        next[idx] = {
          ...cur,
          qty: nq,
          lineTotal: nq * p.priceSale,
        }
        return next
      }
      return [
        ...prev,
        {
          key: newCartLineId(),
          productId: p.id,
          name: p.name,
          barcode: p.barcode,
          isLooseFood: false,
          qty: q,
          grams: 0,
          unitPrice: p.priceSale,
          unitCost: p.priceCost,
          lineTotal: q * p.priceSale,
        },
      ]
    })
    playScanBeep()
    setScannerFeed({ tone: 'ok', text: `+ ${p.name}` })
    window.setTimeout(() => setScannerFeed(null), 1600)
  }, [])

  const tryResolveAndAdd = useCallback(
    (raw) => {
      const digits = String(raw ?? '').replace(/\D/g, '')
      if (digits.length < MIN_CODE_LEN) return false
      const p = products.find((x) => x.barcode === digits)
      if (!p) {
        setScannerFeed({ tone: 'err', text: `Sin coincidencia · ${digits}` })
        window.setTimeout(() => setScannerFeed(null), 2800)
        return true
      }
      if (p.stock < 1) {
        setScannerFeed({ tone: 'err', text: `${p.name} · sin stock` })
        window.setTimeout(() => setScannerFeed(null), 2800)
        return true
      }
      if (p.isLooseFood) {
        setCartLooseProductId(p.id)
        setGramsInput('')
        setIsScanning(false)
        return true
      }
      addLineToCart(p, { qty: 1 })
      setIsScanning(false)
      setQuery('')
      return true
    },
    [products, addLineToCart],
  )

  function updateCartQty(lineKey, delta) {
    setCart((prev) => {
      const line = prev.find((l) => l.key === lineKey)
      if (!line) return prev
      const p = products.find((x) => x.id === line.productId)
      if (!p) return prev
      if (line.isLooseFood) return prev
      const nq = line.qty + delta
      if (nq < 1) return prev.filter((l) => l.key !== lineKey)
      if (nq > p.stock) return prev
      return prev.map((l) =>
        l.key === lineKey
          ? { ...l, qty: nq, lineTotal: nq * l.unitPrice }
          : l,
      )
    })
  }

  function removeLine(lineKey) {
    setCart((prev) => prev.filter((l) => l.key !== lineKey))
  }

  function applyStockFromCart(lines) {
    setProducts((prev) => {
      const dec = new Map()
      for (const l of lines) {
        if (l.isLooseFood) {
          dec.set(l.productId, (dec.get(l.productId) || 0) + l.grams)
        } else {
          dec.set(l.productId, (dec.get(l.productId) || 0) + l.qty)
        }
      }
      return prev.map((item) => {
        const d = dec.get(item.id)
        if (!d) return item
        return { ...item, stock: Math.max(0, item.stock - d) }
      })
    })
  }

  /** Después de cobrar: carrito, montos, vuelto (derivado), búsqueries y foco en escáner. */
  function resetTacticoVenta() {
    if (searchScanTimerRef.current) {
      window.clearTimeout(searchScanTimerRef.current)
      searchScanTimerRef.current = null
    }
    searchScanBufRef.current = ''
    lastSearchDigitAtRef.current = 0
    setCart([])
    setPagaCon('')
    setQuery('')
    setScannerFeed(null)
    setIsScanning(false)
    playCajaRegistradoraBeep()
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        productSearchRef.current?.focus()
        productSearchRef.current?.select?.()
      })
    })
  }

  function finalizeSale(methodKey) {
    if (cart.length === 0) {
      setToast('El carrito está vacío.')
      return
    }
    const lines = [...cart]
    const total = lines.reduce((s, l) => s + l.lineTotal, 0)
    if (methodKey === 'efectivo') {
      const p = Number(String(pagaCon).replace(',', '.'))
      if (!Number.isFinite(p) || p < total) {
        setToast('En efectivo, «Paga con» debe ser ≥ total.')
        return
      }
    }
    const saleRecord = {
      id: `s-${Date.now()}`,
      ts: Date.now(),
      method: methodKey,
      total,
      items: lines.map((l) => ({
        productId: l.productId,
        name: l.name,
        qty: l.isLooseFood ? 0 : l.qty,
        grams: l.isLooseFood ? l.grams : 0,
        unitPrice: l.unitPrice,
        unitCost: l.unitCost,
        lineTotal: l.lineTotal,
      })),
    }
    applyStockFromCart(lines)
    setCaja((c) => ({
      ...c,
      total: c.total + total,
      transactions: c.transactions + 1,
      byMethod: {
        ...c.byMethod,
        [methodKey]: (c.byMethod[methodKey] || 0) + total,
      },
      sales: [...c.sales, saleRecord],
    }))
    resetTacticoVenta()
    setToast(`Venta ${PAYMENT_METHODS.find((m) => m.key === methodKey)?.label || ''}: ${formatArs(total)}`)
  }

  function confirmarPagoEfectivo() {
    finalizeSale('efectivo')
  }

  function confirmarPagoTarjeta() {
    finalizeSale('tarjeta')
  }

  function confirmarPagoQr() {
    finalizeSale('qr')
  }

  function confirmarPagoTransferencia() {
    finalizeSale('transferencia')
  }

  function confirmCartLooseGrams() {
    const p = cartLooseProduct
    if (!p || !p.isLooseFood) return
    const raw = String(gramsInput).replace(',', '.').trim()
    const g = Math.floor(Number(raw))
    if (!Number.isFinite(g) || g < 1 || g > p.stock) {
      setToast('Ingresá gramos válidos (stock disponible).')
      return
    }
    addLineToCart(p, { grams: g })
    setCartLooseProductId(null)
    setGramsInput('')
    setQuery('')
  }

  function exportExcelCsv() {
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`
    const saleRows = caja.sales.flatMap((s) =>
      (s.items || []).map((it) =>
        [
          new Date(s.ts).toLocaleString('es-AR'),
          s.method,
          formatArs(s.total),
          it.name,
          it.grams ? `${it.grams} g` : it.qty,
          formatArs(it.lineTotal),
        ]
          .map(esc)
          .join(';'),
      ),
    )
    const expenseRows = caja.expenses.map((e) =>
      [
        new Date(e.ts).toLocaleString('es-AR'),
        formatArs(e.amount),
        e.note || '',
      ]
        .map(esc)
        .join(';'),
    )
    const csv = [
      '=== Ventas líneas ===',
    'Fecha;Método;Total ticket;Ítem;Cantidad;Subtotal',
    ...saleRows,
    '',
    '=== Gastos ===',
    'Fecha;Monto;Nota',
    ...expenseRows,
    ].join('\n')
    downloadCsv(`kalova-caja-${getTodayKey()}.csv`, csv)
    setToast('Archivo exportado (abrilo con Excel).')
  }

  function saveExpense(e) {
    e.preventDefault()
    const amount = Number(String(expenseForm.amount).replace(',', '.'))
    if (!Number.isFinite(amount) || amount <= 0) return
    setCaja((c) => ({
      ...c,
      expenses: [
        ...c.expenses,
        {
          id: `e-${Date.now()}`,
          amount,
        note: expenseForm.note.trim(),
          ts: Date.now(),
        },
      ],
    }))
    setExpenseForm({ amount: '', note: '' })
    setExpenseModal(false)
    setToast(`Gasto anotado: ${formatArs(amount)}`)
  }

  function limpiarAdminForm() {
    setAdminForm({
      barcode: '',
      name: '',
      priceCost: '',
      priceSale: '',
      stock: '',
      category: 'General',
      isLooseFood: false,
    })
    setEditingProductId(null)
  }

  function cargarProductoEnForm(p) {
    setEditingProductId(p.id)
    setAdminForm({
      barcode: p.barcode,
      name: p.name,
      priceCost: String(p.priceCost),
      priceSale: String(p.priceSale),
      stock: String(p.stock),
      category: p.category || 'General',
      isLooseFood: p.isLooseFood,
    })
  }

  function guardarProductoAdmin(e) {
    e.preventDefault()
    const name = adminForm.name.trim()
    const category = adminForm.category.trim() || 'General'
    const stock = Number(String(adminForm.stock).replace(',', '.'))
    const priceSale = Number(String(adminForm.priceSale).replace(',', '.'))
    const priceCost = Number(String(adminForm.priceCost).replace(',', '.'))
    if (!name || !Number.isFinite(stock) || stock < 0) return
    if (!Number.isFinite(priceSale) || priceSale < 0) return
    if (!Number.isFinite(priceCost) || priceCost < 0) return
    const stockInt = Math.floor(stock)
    const barcodeRaw = adminForm.barcode.trim().replace(/\D/g, '')
    const barcode =
      barcodeRaw ||
      `780${String(Date.now()).slice(-10)}${String(products.length)}`
    if (editingProductId) {
      if (products.some((x) => x.barcode === barcode && x.id !== editingProductId)) {
        setToast('Ya existe otro producto con ese código.')
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
                priceCost,
                isLooseFood: adminForm.isLooseFood,
                barcode,
              }
            : item,
        ),
      )
      setToast('Producto actualizado.')
    } else {
      if (products.some((x) => x.barcode === barcode)) {
        setToast('Ya existe un producto con ese código.')
        return
      }
      setProducts((prev) => [
        ...prev,
        createProduct({
          name,
          category,
          stock: stockInt,
          priceSale,
          priceCost,
          isLooseFood: adminForm.isLooseFood,
          barcode,
        }),
      ])
      setToast('Producto guardado.')
    }
    limpiarAdminForm()
  }

  function eliminarProducto() {
    const t = deleteConfirm
    if (!t) return
    setProducts((prev) => prev.filter((x) => x.id !== t.id))
    setDeleteConfirm(null)
    if (editingProductId === t.id) limpiarAdminForm()
    setToast(`Eliminado: ${t.name}`)
  }

  function handleCierreTxt() {
    const now = new Date().toLocaleString('es-AR')
    const lines = [
      '══════════════════════════════════════',
      '  CIERRE — KaloVa POS',
      '══════════════════════════════════════',
      '',
      `Generado: ${now}`,
      `Fecha: ${getTodayKey()}`,
      '',
      `Recaudación: ${formatArs(caja.total)}`,
      `Tickets: ${caja.transactions}`,
      `Gastos: ${formatArs(expensesTotal)}`,
      `Balance neto: ${formatArs(netBalance)}`,
      '',
      'Por método:',
      ...PAYMENT_METHODS.map(
        (m) => `  ${m.label}: ${formatArs(caja.byMethod[m.key] || 0)}`,
      ),
      '',
      '── Inventario ──',
      ...products.map(
        (p) =>
          `${p.name} | ${p.barcode} | ${stockLabel(p)} | ${formatArs(p.priceSale)}`,
      ),
    ]
    downloadTextFile(`cierre-${getTodayKey()}.txt`, lines.join('\n'))
    setToast('Cierre exportado (.txt).')
  }

  function handleLogoNavClick() {
    window.location.reload()
  }

  useEffect(() => {
    function onF1(ev) {
      if (ev.key !== 'F1') return
      if (mainTab !== 'venta') return
      if (barcodeCameraTarget || cartLooseProductId || deleteConfirm) {
        ev.preventDefault()
        return
      }
      ev.preventDefault()
      setIsScanning(true)
      window.requestAnimationFrame(() => {
        productSearchRef.current?.focus()
        productSearchRef.current?.select?.()
      })
    }
    window.addEventListener('keydown', onF1, true)
    return () => window.removeEventListener('keydown', onF1, true)
  }, [mainTab, barcodeCameraTarget, cartLooseProductId, deleteConfirm])

  useEffect(() => {
    function onEsc(ev) {
      if (ev.key !== 'Escape') return
      if (barcodeCameraTarget) {
        setBarcodeCameraTarget(null)
        return
      }
      if (cartLooseProductId) {
        setCartLooseProductId(null)
        return
      }
      if (deleteConfirm) {
        setDeleteConfirm(null)
        return
      }
      if (expenseModal) {
        setExpenseModal(false)
        return
      }
      setIsScanning(false)
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [
    barcodeCameraTarget,
    cartLooseProductId,
    deleteConfirm,
    expenseModal,
  ])

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
            if (target === 'venta-scan') {
              tryResolveAndAdd(value)
              setQuery('')
            } else if (target === 'admin-barcode') {
              setAdminForm((f) => ({
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
            } else setBarcodeCameraTarget(null)
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
  }, [barcodeCameraTarget, tryResolveAndAdd])

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
      if (code.length < MIN_CODE_LEN) code = query.replace(/\D/g, '')
      if (code.length >= MIN_CODE_LEN) tryResolveAndAdd(code)
      setQuery('')
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
    if (searchScanTimerRef.current)
      window.clearTimeout(searchScanTimerRef.current)
    searchScanTimerRef.current = window.setTimeout(() => {
      searchScanTimerRef.current = null
      const b = searchScanBufRef.current
      searchScanBufRef.current = ''
      if (b.length >= MIN_CODE_LEN) tryResolveAndAdd(b)
      setQuery('')
    }, SCAN_IDLE_FLUSH_MS)
  }

  return (
    <div className="min-h-screen bg-[#0d0d0f] text-zinc-100">
      <nav
        className="sticky top-0 z-40 border-b border-red-900/40 bg-[#121214]/95 backdrop-blur-md"
        aria-label="KaloVa POS"
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={handleLogoNavClick}
              className="shrink-0 rounded-lg p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff003c]"
              aria-label="Recargar"
            >
              <img
                src={logoKalova}
                alt="KaloVa"
                className="h-12 w-auto max-w-[180px] object-contain sm:h-14"
                decoding="async"
              />
            </button>
            <div className="hidden h-10 w-px bg-white/10 sm:block" />
            <div className="flex min-w-0 flex-col">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#ff003c]">
                KaloVa POS táctico
              </span>
              <span className="truncate text-xs text-zinc-500 capitalize">
                {todayLongLabel}
              </span>
            </div>
          </div>
          <div className="flex w-full gap-1 rounded-xl border border-red-900/40 bg-[#1a1a1c] p-1 sm:w-auto">
            <button
              type="button"
              onClick={() => setMainTab('venta')}
              className={`flex-1 rounded-lg px-4 py-2.5 text-xs font-bold uppercase tracking-wide sm:flex-none ${
                mainTab === 'venta'
                  ? 'bg-[#ff003c] text-white shadow-[0_0_20px_rgb(255_0_60_/0.35)]'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Venta táctica
            </button>
            <button
              type="button"
              onClick={() => setMainTab('admin')}
              className={`flex-1 rounded-lg px-4 py-2.5 text-xs font-bold uppercase tracking-wide sm:flex-none ${
                mainTab === 'admin'
                  ? 'bg-[#ff003c] text-white shadow-[0_0_20px_rgb(255_0_60_/0.35)]'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Administración
            </button>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {mainTab === 'venta' && (
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-4 lg:col-span-7">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={() => setBarcodeCameraTarget('venta-scan')}
                  disabled={!!barcodeCameraTarget || !!cartLooseProductId}
                  className="flex min-h-[52px] w-full items-center justify-center gap-3 rounded-2xl border-2 border-[#ff003c] bg-gradient-to-r from-[#ff003c]/20 to-[#121214] py-3 text-base font-extrabold uppercase tracking-wide text-[#ff003c] shadow-[0_0_28px_rgb(255_0_60_/0.25)] transition hover:brightness-110 disabled:opacity-40 sm:max-w-xl"
                >
                  <span className="text-2xl" aria-hidden>
                    📷
                  </span>
                  Escanear producto
                </button>
              </div>

              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
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
                        ? 'Buscar o código (F1)…'
                        : 'Buscar producto…'
                    }
                    autoComplete="off"
                    className="w-full rounded-xl border border-red-900/50 bg-[#121214] py-3 pl-10 pr-3 text-base text-white placeholder:text-zinc-500 focus:border-[#ff003c]/50 focus:outline-none focus:ring-2 focus:ring-[#ff003c]/25"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setBarcodeCameraTarget('venta-scan')}
                  disabled={!!barcodeCameraTarget}
                  className="flex h-[50px] w-14 shrink-0 items-center justify-center rounded-xl border-2 border-[#ff003c] bg-[#121214] text-[#ff003c] disabled:opacity-40"
                  aria-label="Cámara"
                >
                  <CameraIcon className="h-6 w-6" />
                </button>
              </div>

              <div
                className={`rounded-lg border px-3 py-2 ${
                  isScanning
                    ? 'border-scan-pulse border-red-800/60'
                    : 'border-red-900/40'
                } bg-[#121214]`}
              >
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#ff003c]">
                  {showF1Hint
                    ? 'Escáner · F1 enfoca búsqueda'
                    : 'Escáner · cámara o teclado'}
                </p>
                {scannerFeed && (
                  <p
                    className={`mt-1 text-xs ${
                      scannerFeed.tone === 'err'
                        ? 'text-stock-alert'
                        : 'text-[#ff003c]'
                    }`}
                  >
                    {scannerFeed.text}
                  </p>
                )}
              </div>

              <div className="max-h-[min(40vh,320px)] overflow-y-auto rounded-xl border border-red-900/40 bg-[#121214] p-2 sm:max-h-[280px]">
                <p className="px-2 py-1 text-[10px] font-bold uppercase text-zinc-500">
                  Toque para agregar
                </p>
                <ul className="space-y-1">
                  {filtered.length === 0 ? (
                    <li className="px-3 py-8 text-center text-sm text-zinc-500">
                      Sin productos que coincidan.
                    </li>
                  ) : (
                    filtered.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          disabled={p.stock < 1}
                          onClick={() => {
                            if (p.isLooseFood) {
                              setCartLooseProductId(p.id)
                              setGramsInput('')
                            } else addLineToCart(p, { qty: 1 })
                          }}
                          className="flex w-full items-center justify-between gap-2 rounded-lg border border-transparent px-3 py-2.5 text-left transition hover:border-[#ff003c]/30 hover:bg-[#1a1a1c] disabled:opacity-35"
                        >
                          <span className="font-medium text-white">
                            {p.name}
                            {p.isLooseFood && (
                              <span className="ml-2 text-[10px] text-zinc-500">
                                granel
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-sm font-semibold text-[#ff003c]">
                            {formatArs(p.priceSale)}
                            {p.isLooseFood && (
                              <span className="text-[10px] text-zinc-500">
                                /kg
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>

              <div className="rounded-2xl border border-red-900/50 bg-[#121214] p-4 shadow-[inset_0_1px_0_rgb(255_255_255_/0.04)]">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-[#ff003c]">
                    Carrito
                  </h3>
                  <span className="text-xs text-zinc-500">
                    {cart.length} línea{cart.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <ul className="max-h-48 space-y-2 overflow-y-auto">
                  {cart.length === 0 ? (
                    <li className="py-6 text-center text-sm text-zinc-500">
                      Escaneá o tocá un producto…
                    </li>
                  ) : (
                    cart.map((l) => (
                      <li
                        key={l.key}
                        className="cart-line-enter flex items-center gap-2 rounded-xl border border-white/5 bg-[#1a1a1c] px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-white">
                            {l.name}
                          </p>
                          <p className="text-[11px] text-zinc-500">
                            {l.isLooseFood
                              ? `${l.grams.toLocaleString('es-AR')} g`
                              : `${l.qty} u.`}{' '}
                            × {formatArs(l.unitPrice)}
                          </p>
                        </div>
                        {!l.isLooseFood && (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => updateCartQty(l.key, -1)}
                              className="h-9 w-9 rounded-lg border border-zinc-600 text-lg font-bold text-white hover:border-[#ff003c]"
                            >
                              −
                            </button>
                            <button
                              type="button"
                              onClick={() => updateCartQty(l.key, 1)}
                              className="h-9 w-9 rounded-lg border border-zinc-600 text-lg font-bold text-white hover:border-[#ff003c]"
                            >
                              +
                            </button>
                          </div>
                        )}
                        <span className="shrink-0 text-sm font-bold tabular-nums text-[#ff003c]">
                          {formatArs(l.lineTotal)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeLine(l.key)}
                          className="shrink-0 rounded-lg px-2 py-1 text-xs text-zinc-500 hover:text-stock-alert"
                          aria-label="Quitar"
                        >
                          ✕
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>

            <div className="lg:col-span-5">
              <div className="sticky top-24 space-y-4 rounded-2xl border-2 border-red-900/50 bg-[#121214] p-5 shadow-[0_0_40px_rgb(0_0_0_/0.4)]">
                <h3 className="text-center text-[11px] font-bold uppercase tracking-[0.28em] text-zinc-500">
                  Cobro
                </h3>
                <div className="rounded-xl bg-[#1a1a1c] px-4 py-4 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    Total a cobrar
                  </p>
                  <p className="mt-1 text-3xl font-black tabular-nums text-white sm:text-4xl">
                    {formatArs(cartTotal)}
                  </p>
                </div>
                <div>
                  <label
                    className="text-xs font-semibold uppercase tracking-wide text-zinc-400"
                    htmlFor="paga-con"
                  >
                    Paga con
                  </label>
                  <input
                    id="paga-con"
                    inputMode="decimal"
                    value={pagaCon}
                    onChange={(e) => setPagaCon(e.target.value)}
                    placeholder="0"
                    className="mt-1 w-full rounded-xl border border-red-900/40 bg-[#1a1a1c] px-4 py-3 text-2xl font-bold tabular-nums text-white focus:border-[#ff003c]/50 focus:outline-none focus:ring-2 focus:ring-[#ff003c]/20"
                  />
                </div>
                <div className="rounded-xl border border-red-900/30 bg-[#0d0d0f] px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase text-zinc-500">
                    Vuelto
                  </p>
                  <p className="text-xl font-bold tabular-nums text-[#22c55e]">
                    {cartTotal > 0 && Number.isFinite(pagaNum) && pagaNum >= cartTotal
                      ? formatArs(vuelto)
                      : '—'}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {PAYMENT_METHODS.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => {
                        if (m.key === 'efectivo') confirmarPagoEfectivo()
                        else if (m.key === 'tarjeta') confirmarPagoTarjeta()
                        else if (m.key === 'qr') confirmarPagoQr()
                        else confirmarPagoTransferencia()
                      }}
                      disabled={cart.length === 0}
                      style={{ backgroundColor: m.bg }}
                      className="min-h-[64px] rounded-2xl px-2 py-3 text-sm font-extrabold uppercase leading-tight text-white shadow-lg transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {mainTab === 'admin' && (
          <div className="space-y-8">
            <section className="rounded-2xl border border-red-900/50 bg-[#121214] p-5 sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-xs font-extrabold uppercase tracking-[0.25em] text-[#ff003c]">
                    Caja y rentabilidad
                  </h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Datos reales de ventas completadas hoy
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={exportExcelCsv}
                    className="rounded-xl border border-[#0ea5e9] bg-[#0ea5e9]/15 px-4 py-2.5 text-xs font-bold uppercase text-[#0ea5e9] hover:bg-[#0ea5e9]/25"
                  >
                    Exportar Excel
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpenseModal(true)}
                    className="rounded-xl border border-[#f97316] bg-[#f97316]/15 px-4 py-2.5 text-xs font-bold uppercase text-[#f97316] hover:bg-[#f97316]/25"
                  >
                    Anotar gasto
                  </button>
                  <button
                    type="button"
                    onClick={handleCierreTxt}
                    className="rounded-xl border border-white/20 px-4 py-2.5 text-xs font-bold uppercase text-white hover:bg-white/10"
                  >
                    Cierre .txt
                  </button>
                </div>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-red-900/40 bg-[#1a1a1c] p-4">
                  <p className="text-[10px] font-semibold uppercase text-zinc-500">
                    Balance de hoy
                  </p>
                  <p className="mt-1 text-2xl font-black text-white">
                    {formatArs(netBalance)}
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Recaudado − gastos
                  </p>
                </div>
                <div className="rounded-xl border border-red-900/40 bg-[#1a1a1c] p-4">
                  <p className="text-[10px] font-semibold uppercase text-zinc-500">
                    Recaudación
                  </p>
                  <p className="mt-1 text-2xl font-black text-[#ff003c]">
                    {formatArs(caja.total)}
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {caja.transactions} tickets
                  </p>
                </div>
                <div className="rounded-xl border border-red-900/40 bg-[#1a1a1c] p-4">
                  <p className="text-[10px] font-semibold uppercase text-zinc-500">
                    Margen bruto (hoy)
                  </p>
                  <p className="mt-1 text-2xl font-black text-[#22c55e]">
                    {formatArs(profitToday)}
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Venta − costo cargado
                  </p>
                </div>
                <div className="rounded-xl border border-red-900/40 bg-[#1a1a1c] p-4">
                  <p className="text-[10px] font-semibold uppercase text-zinc-500">
                    Gastos
                  </p>
                  <p className="mt-1 text-2xl font-black text-[#f97316]">
                    {formatArs(expensesTotal)}
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {caja.expenses.length} registros
                  </p>
                </div>
              </div>
              <div className="mt-6 rounded-xl border border-white/5 bg-[#1a1a1c] p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  Ventas por método
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {PAYMENT_METHODS.map((m) => (
                    <div
                      key={m.key}
                      className="flex items-center justify-between rounded-lg border border-white/5 px-3 py-2"
                    >
                      <span className="text-sm font-medium text-zinc-300">
                        {m.label}
                      </span>
                      <span
                        className="font-bold tabular-nums"
                        style={{ color: m.bg }}
                      >
                        {formatArs(caja.byMethod[m.key] || 0)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              {lowStockCount > 0 && (
                <p className="mt-4 text-xs text-stock-alert">
                  ⚠ {lowStockCount} producto(s) bajo stock
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-red-900/50 bg-[#121214] p-5 sm:p-6">
              <h2 className="text-xs font-extrabold uppercase tracking-[0.25em] text-[#ff003c]">
                Editor de productos
              </h2>
              <form
                onSubmit={guardarProductoAdmin}
                className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
              >
                <div>
                  <label className="text-xs font-medium text-zinc-400">
                    Código (EAN)
                  </label>
                  <div className="mt-1 flex gap-2">
                    <input
                      value={adminForm.barcode}
                      onChange={(e) =>
                        setAdminForm((f) => ({ ...f, barcode: e.target.value }))
                      }
                      className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#1a1a1c] px-3 py-2.5 text-sm text-white focus:border-[#ff003c]/40 focus:outline-none"
                      placeholder="Código"
                      inputMode="numeric"
                    />
                    <button
                      type="button"
                      onClick={() => setBarcodeCameraTarget('admin-barcode')}
                      disabled={!!barcodeCameraTarget}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 border-[#ff003c] text-[#ff003c] disabled:opacity-40"
                      aria-label="Escanear código"
                    >
                      <CameraIcon className="h-5 w-5" />
                    </button>
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-zinc-400">
                    Nombre
                  </label>
                  <input
                    required
                    value={adminForm.name}
                    onChange={(e) =>
                      setAdminForm((f) => ({ ...f, name: e.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1a1c] px-3 py-2.5 text-sm text-white focus:border-[#ff003c]/40 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-400">
                    Costo (ARS)
                  </label>
                  <input
                    required
                    type="number"
                    min={0}
                    step="0.01"
                    value={adminForm.priceCost}
                    onChange={(e) =>
                      setAdminForm((f) => ({ ...f, priceCost: e.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1a1c] px-3 py-2.5 text-sm text-white focus:border-[#ff003c]/40 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-400">
                    Venta (ARS{adminForm.isLooseFood ? ' /kg' : ''})
                  </label>
                  <input
                    required
                    type="number"
                    min={0}
                    step="0.01"
                    value={adminForm.priceSale}
                    onChange={(e) =>
                      setAdminForm((f) => ({ ...f, priceSale: e.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1a1c] px-3 py-2.5 text-sm text-white focus:border-[#ff003c]/40 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-400">
                    Stock ({adminForm.isLooseFood ? 'g' : 'u.'})
                  </label>
                  <input
                    required
                    type="number"
                    min={0}
                    value={adminForm.stock}
                    onChange={(e) =>
                      setAdminForm((f) => ({ ...f, stock: e.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1a1c] px-3 py-2.5 text-sm text-white focus:border-[#ff003c]/40 focus:outline-none"
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="text-xs font-medium text-zinc-400">
                    Categoría
                  </label>
                  <input
                    value={adminForm.category}
                    onChange={(e) =>
                      setAdminForm((f) => ({
                        ...f,
                        category: e.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1a1c] px-3 py-2.5 text-sm text-white focus:border-[#ff003c]/40 focus:outline-none"
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-2 sm:col-span-2 lg:col-span-3">
                  <input
                    type="checkbox"
                    checked={adminForm.isLooseFood}
                    onChange={(e) =>
                      setAdminForm((f) => ({
                        ...f,
                        isLooseFood: e.target.checked,
                      }))
                    }
                    className="accent-[#ff003c]"
                  />
                  <span className="text-sm text-zinc-400">
                    Producto a granel (stock en gramos, precio por kg)
                  </span>
                </label>
                <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-3">
                  <button
                    type="submit"
                    className="rounded-xl bg-[#ff003c] px-6 py-3 text-sm font-extrabold uppercase text-white shadow-[0_0_24px_rgb(255_0_60_/0.35)]"
                  >
                    {editingProductId ? 'Editar / Guardar' : 'Guardar'}
                  </button>
                  <button
                    type="button"
                    onClick={limpiarAdminForm}
                    className="rounded-xl border-2 border-white/30 px-6 py-3 text-sm font-bold uppercase text-white hover:bg-white/10"
                  >
                    Limpiar
                  </button>
                </div>
              </form>
            </section>

            <section className="overflow-hidden rounded-2xl border border-red-900/50 bg-[#121214]">
              <div className="border-b border-red-900/40 px-5 py-3">
                <h2 className="text-xs font-extrabold uppercase tracking-[0.25em] text-zinc-400">
                  Inventario (ABM)
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      <th className="px-4 py-3">Código</th>
                      <th className="px-4 py-3">Nombre</th>
                      <th className="px-4 py-3 text-right">Costo</th>
                      <th className="px-4 py-3 text-right">Venta</th>
                      <th className="px-4 py-3 text-right">Stock</th>
                      <th className="px-4 py-3 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-12 text-center text-zinc-500"
                        >
                          No hay productos. Completá el formulario y guardá.
                        </td>
                      </tr>
                    ) : (
                      products.map((p) => (
                        <tr
                          key={p.id}
                          className="border-b border-white/[0.06] hover:bg-white/[0.02]"
                        >
                          <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                            {p.barcode}
                          </td>
                          <td className="px-4 py-3 font-medium text-white">
                            {p.name}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-zinc-400">
                            {formatArs(p.priceCost)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-[#ff003c]">
                            {formatArs(p.priceSale)}
                            {p.isLooseFood && (
                              <span className="text-[10px] text-zinc-500">
                                /kg
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-zinc-300">
                            {stockLabel(p)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => cargarProductoEnForm(p)}
                                className="rounded-lg border border-white/10 bg-[#1a1a1c] p-2 text-zinc-400 hover:border-[#ff003c]/50 hover:text-[#ff003c]"
                                title="Editar"
                                aria-label={`Editar ${p.name}`}
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
                                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                  />
                                </svg>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteConfirm({ id: p.id, name: p.name })
                                }
                                className="rounded-lg border border-red-900/50 bg-[#1a1a1c] p-2 text-red-400 hover:border-[#ff003c] hover:text-[#ff003c]"
                                title="Eliminar"
                                aria-label={`Eliminar ${p.name}`}
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
                                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                  />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </div>

      {toast && (
        <div
          className="pointer-events-none fixed bottom-6 left-1/2 z-[100] max-w-md -translate-x-1/2 rounded-xl border border-[#ff003c]/40 bg-[#121214]/95 px-4 py-3 text-center shadow-xl backdrop-blur"
          role="status"
        >
          <p className="text-sm font-semibold text-white">{toast}</p>
        </div>
      )}

      {cartLooseProduct && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-red-900/50 bg-[#121214] p-6 shadow-2xl">
            <p className="text-[10px] font-bold uppercase text-[#ff003c]">
              Granel · {cartLooseProduct.name}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Stock: {cartLooseProduct.stock.toLocaleString('es-AR')} g ·{' '}
              {formatArs(cartLooseProduct.priceSale)}/kg
            </p>
            <label className="mt-4 block text-xs font-medium text-zinc-400">
              Gramos
            </label>
            <input
              value={gramsInput}
              onChange={(e) => setGramsInput(e.target.value)}
              inputMode="numeric"
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1a1c] px-3 py-3 text-xl font-bold text-white focus:border-[#ff003c]/40 focus:outline-none"
              placeholder="ej. 350"
              autoFocus
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCartLooseProductId(null)
                  setGramsInput('')
                }}
                className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmCartLooseGrams}
                className="rounded-lg bg-[#ff003c] px-4 py-2 text-sm font-bold text-white"
              >
                Agregar al carrito
              </button>
            </div>
          </div>
        </div>
      )}

      {expenseModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
        >
          <form
            onSubmit={saveExpense}
            className="w-full max-w-sm rounded-2xl border border-red-900/50 bg-[#121214] p-6"
          >
            <h3 className="text-lg font-semibold text-white">Anotar gasto</h3>
            <label className="mt-4 block text-xs text-zinc-400">
              Monto (ARS)
            </label>
            <input
              required
              type="number"
              min={0.01}
              step="0.01"
              value={expenseForm.amount}
              onChange={(e) =>
                setExpenseForm((f) => ({ ...f, amount: e.target.value }))
              }
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1a1c] px-3 py-2 text-white"
            />
            <label className="mt-3 block text-xs text-zinc-400">Nota</label>
            <input
              value={expenseForm.note}
              onChange={(e) =>
                setExpenseForm((f) => ({ ...f, note: e.target.value }))
              }
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#1a1a1c] px-3 py-2 text-white"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setExpenseModal(false)}
                className="rounded-lg border border-white/20 px-4 py-2 text-sm"
              >
                Cerrar
              </button>
              <button
                type="submit"
                className="rounded-lg bg-[#f97316] px-4 py-2 text-sm font-bold text-white"
              >
                Guardar
              </button>
            </div>
          </form>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-red-900/50 bg-[#121214] p-6">
            <p className="font-semibold text-white">¿Eliminar producto?</p>
            <p className="mt-2 text-sm text-zinc-400">{deleteConfirm.name}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="rounded-lg border px-4 py-2 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={eliminarProducto}
                className="rounded-lg bg-[#ff003c] px-4 py-2 text-sm font-bold text-white"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {barcodeCameraTarget && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setBarcodeCameraTarget(null)}
        >
          <div
            className="w-full max-w-sm overflow-hidden rounded-xl border-2 border-[#ff003c] bg-black shadow-[0_0_28px_rgb(255_0_60_/0.45)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between border-b border-red-900/60 bg-[#121214] px-3 py-2">
              <span className="text-xs font-bold uppercase text-[#ff003c]">
                Escanear
              </span>
              <button
                type="button"
                onClick={() => setBarcodeCameraTarget(null)}
                className="text-xs text-zinc-400"
              >
                Cerrar
              </button>
            </div>
            <div
              id="kalova-barcode-reader"
              className="min-h-[220px] [&_video]:w-full [&_video]:object-cover"
            />
          </div>
        </div>
      )}
    </div>
  )
}
