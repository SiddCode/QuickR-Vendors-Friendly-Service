import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { 
  X, 
  Upload, 
  FileSpreadsheet, 
  CheckCircle2, 
  AlertTriangle, 
  Download, 
  ArrowRight, 
  ArrowLeft,
  Loader2
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useLanguage } from '../context/LanguageContext';

interface ProductImportModalProps {
  onClose: () => void;
}

// QuickR target field definitions
const QUICKR_FIELDS = [
  { key: 'name', label: 'Product Name', required: true },
  { key: 'sellingPrice', label: 'Selling Price (₹)', required: true },
  { key: 'originalPrice', label: 'MRP / Original Price (₹)', required: false },
  { key: 'availability', label: 'Stock (Qty)', required: false },
  { key: 'category', label: 'Category', required: false },
  { key: 'sizes', label: 'Size(s)', required: false },
  { key: 'colors', label: 'Color(s)', required: false },
  { key: 'barcode', label: 'Barcode', required: false }
];

// Heuristic column matching
const COLUMN_ALIASES: Record<string, string[]> = {
  name: ['product name', 'product', 'item name', 'item', 'name', 'description', 'title'],
  sellingPrice: ['selling price', 'sale price', 'price', 'rate', 'selling rate', 'retail price', 'sp'],
  originalPrice: ['mrp', 'maximum retail price', 'retail mrp', 'original price'],
  availability: ['stock', 'quantity', 'qty', 'opening stock', 'available stock', 'count'],
  category: ['category', 'product category', 'type', 'department'],
  sizes: ['size', 'sizes'],
  colors: ['color', 'colour', 'variant color', 'variant colour', 'colors', 'colours'],
  barcode: ['barcode', 'bar code', 'barcode no', 'barcode number', 'code', 'item code', 'sku', 'upc', 'ean']
};

export const ProductImportModal: React.FC<ProductImportModalProps> = ({ onClose }) => {
  const { importProducts } = useApp();
  const { t } = useLanguage();

  const [step, setStep] = useState<'upload' | 'mapping' | 'preview' | 'complete'>('upload');
  
  // File state
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);

  // Raw file headers and data rows
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<any[]>([]);

  // Mapping state: QuickR field -> Excel Column Name
  const [mapping, setMapping] = useState<Record<string, string>>({});

  // Import Result & Issues state
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importSummary, setImportSummary] = useState<any>(null);
  const [importIssues, setImportIssues] = useState<any[]>([]);
  const [issueFilter, setIssueFilter] = useState<'all' | 'duplicates' | 'errors'>('all');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Download Sample Template
  const handleDownloadTemplate = () => {
    const templateData = [
      {
        "Product Name": "Cotton Formal Shirt",
        "Category": "Shirts",
        "Size": "M, L, XL",
        "Color": "Blue, Black",
        "Selling Price": 999,
        "MRP": 1499,
        "Stock": 25,
        "Barcode": "8901234567890"
      },
      {
        "Product Name": "Slim Fit Denim Jeans",
        "Category": "Jeans",
        "Size": "32, 34",
        "Color": "Dark Blue",
        "Selling Price": 1299,
        "MRP": 1899,
        "Stock": 15,
        "Barcode": "CP-001245"
      },
      {
        "Product Name": "Casual Polo T-Shirt",
        "Category": "T-Shirts",
        "Size": "L",
        "Color": "Red",
        "Selling Price": 599,
        "MRP": 799,
        "Stock": 30,
        "Barcode": "" // Blank barcode to test auto-generation
      }
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Products");
    XLSX.writeFile(wb, "QuickR_Bulk_Product_Import_Template.xlsx");
  };

  // Step 1: File Selection & Reading
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFileError(null);

    // 20 MB Limit check
    if (selectedFile.size > 20 * 1024 * 1024) {
      setFileError('File is too large. Please upload an Excel/CSV file up to 20 MB.');
      return;
    }

    const extension = selectedFile.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(extension || '')) {
      setFileError('Unsupported file format. Please upload a valid .xlsx, .xls, or .csv file.');
      return;
    }

    setFile(selectedFile);
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        // raw: true to preserve leading zeroes in string columns
        const wb = XLSX.read(data, { type: 'array', cellText: true, cellDates: true, raw: true });
        setWorkbook(wb);
        setSheets(wb.SheetNames);
        const firstSheetName = wb.SheetNames[0];
        setSelectedSheet(firstSheetName);
        parseSheet(wb, firstSheetName);
      } catch (err) {
        setFileError('Failed to parse Excel/CSV file. Please verify file format.');
      }
    };

    reader.readAsArrayBuffer(selectedFile);
  };

  const parseSheet = (wb: XLSX.WorkBook, sheetName: string) => {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return;

    // Convert sheet to header + rows
    const jsonRows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!jsonRows || jsonRows.length === 0) {
      setFileError('The selected sheet is empty.');
      return;
    }

    // Extract headers (first non-empty row)
    const rawHeaderRow = jsonRows[0] || [];
    const extractedHeaders = rawHeaderRow.map((h: any) => String(h).trim()).filter(Boolean);

    setHeaders(extractedHeaders);

    // Extract data rows
    const dataRows = jsonRows.slice(1).filter((r: any) => r.some((cell: any) => String(cell).trim() !== ''));
    setRawRows(dataRows);

    // Auto Column Detection
    const autoMapping: Record<string, string> = {};
    QUICKR_FIELDS.forEach(field => {
      const aliases = COLUMN_ALIASES[field.key] || [];
      const matchedHeader = extractedHeaders.find((h: string) => {
        const clean = h.toLowerCase().trim();
        return aliases.includes(clean);
      });
      if (matchedHeader) {
        autoMapping[field.key] = matchedHeader;
      }
    });

    setMapping(autoMapping);
  };

  const handleSheetSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSheet = e.target.value;
    setSelectedSheet(newSheet);
    if (workbook) {
      parseSheet(workbook, newSheet);
    }
  };

  // Step 2: Mapping Validation
  const handleProceedToPreview = () => {
    if (!mapping['name']) {
      alert('Please map the "Product Name" column. It is required.');
      return;
    }
    setStep('preview');
  };

  // Prepare Normalized Payload for Preview & Import
  const buildNormalizedProducts = () => {
    return rawRows.map((rowArray, idx) => {
      const getVal = (fieldKey: string) => {
        const colHeader = mapping[fieldKey];
        if (!colHeader) return undefined;
        const colIndex = headers.indexOf(colHeader);
        if (colIndex === -1) return undefined;
        return rowArray[colIndex];
      };

      const name = String(getVal('name') || '').trim();
      const rawSellingPrice = getVal('sellingPrice');
      const rawMrp = getVal('originalPrice');
      const rawStock = getVal('availability');
      const category = String(getVal('category') || '').trim();
      const sizes = getVal('sizes');
      const colors = getVal('colors');
      const barcodeVal = getVal('barcode');

      // Preserve string leading zeroes for Barcode!
      const barcodeStr = barcodeVal !== undefined && barcodeVal !== null && String(barcodeVal).trim() !== ''
        ? String(barcodeVal).trim()
        : null;

      return {
        excelRow: idx + 2,
        name,
        sellingPrice: rawSellingPrice,
        originalPrice: rawMrp,
        availability: rawStock,
        category: category || 'General',
        sizes,
        colors,
        barcode: barcodeStr
      };
    });
  };

  const normalizedProducts = buildNormalizedProducts();
  const validPreviewCount = normalizedProducts.filter(p => p.name).length;
  const invalidPreviewCount = normalizedProducts.length - validPreviewCount;

  // Step 3: Execute Import
  const handleStartImport = async () => {
    setIsImporting(true);
    try {
      const payload = buildNormalizedProducts();
      const res = await importProducts(payload);
      setImportSummary(res.summary);
      setImportIssues(res.issues || []);
      setStep('complete');
    } catch (err: any) {
      alert(err.message || 'Import failed. Please try again.');
    } finally {
      setIsImporting(false);
    }
  };

  // Download Error Report CSV
  const handleDownloadErrorReport = () => {
    if (!importIssues || importIssues.length === 0) return;

    const reportRows = importIssues.map(issue => ({
      "Row Number": issue.row,
      "Product Name": issue.productName,
      "Barcode": `'${issue.barcode}`, // Force text in Excel for leading zeroes
      "Issue Description": issue.issue,
      "Suggested Fix": issue.suggestedFix
    }));

    const ws = XLSX.utils.json_to_sheet(reportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Import_Issues");
    XLSX.writeFile(wb, `QuickR_Import_Issues_Report_${Date.now()}.xlsx`);
  };

  const filteredIssues = importIssues.filter(issue => {
    if (issueFilter === 'duplicates') return issue.issue.toLowerCase().includes('duplicate');
    if (issueFilter === 'errors') return !issue.issue.toLowerCase().includes('duplicate');
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm font-sans animate-fadeIn">
      <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col border border-slate-100 overflow-hidden">
        
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-primary-600" />
              {t('import.importProducts', 'Bulk Product Import')}
            </h2>
            <p className="text-xs text-slate-400 font-medium">Onboard 5,000–10,000+ clothing products seamlessly</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Multi-Step Stepper Bar */}
        <div className="bg-slate-100/70 border-b border-slate-200 px-6 py-2.5 flex items-center justify-between text-xs font-bold text-slate-500 overflow-x-auto shrink-0">
          <div className={`flex items-center gap-1.5 ${step === 'upload' ? 'text-primary-600 font-extrabold' : ''}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === 'upload' ? 'bg-primary-600 text-white' : 'bg-slate-300 text-slate-700'}`}>1</span>
            Upload File
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
          <div className={`flex items-center gap-1.5 ${step === 'mapping' ? 'text-primary-600 font-extrabold' : ''}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === 'mapping' ? 'bg-primary-600 text-white' : 'bg-slate-300 text-slate-700'}`}>2</span>
            Map Columns
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
          <div className={`flex items-center gap-1.5 ${step === 'preview' ? 'text-primary-600 font-extrabold' : ''}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === 'preview' ? 'bg-primary-600 text-white' : 'bg-slate-300 text-slate-700'}`}>3</span>
            Validate & Preview
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
          <div className={`flex items-center gap-1.5 ${step === 'complete' ? 'text-emerald-600 font-extrabold' : ''}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === 'complete' ? 'bg-emerald-600 text-white' : 'bg-slate-300 text-slate-700'}`}>4</span>
            Complete
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 flex-1 overflow-y-auto min-h-0 space-y-6">

          {/* STEP 1: UPLOAD */}
          {step === 'upload' && (
            <div className="space-y-6 max-w-2xl mx-auto">
              <div className="text-center space-y-1">
                <h3 className="text-base font-bold text-slate-800">Upload Product Inventory Spreadsheet</h3>
                <p className="text-xs text-slate-500">Supports .xlsx, .xls, and .csv files up to 20 MB</p>
              </div>

              {/* Upload Dropzone */}
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 hover:border-primary-500 bg-slate-50/50 hover:bg-primary-50/30 rounded-3xl p-8 text-center cursor-pointer transition-all space-y-3 group"
              >
                <div className="w-14 h-14 bg-primary-50 text-primary-600 rounded-2xl flex items-center justify-center mx-auto group-hover:scale-110 transition-transform">
                  <Upload className="w-7 h-7" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-700">Click to select file from your computer</p>
                  <p className="text-xs text-slate-400 mt-1">Excel (.xlsx, .xls) or CSV format</p>
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                />
              </div>

              {fileError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 p-3.5 rounded-xl text-xs font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{fileError}</span>
                </div>
              )}

              {file && !fileError && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileSpreadsheet className="w-6 h-6 text-emerald-600 shrink-0" />
                      <div>
                        <p className="font-bold text-sm text-slate-800">{file.name}</p>
                        <p className="text-xs text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB • {rawRows.length} rows detected</p>
                      </div>
                    </div>
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  </div>

                  {sheets.length > 1 && (
                    <div className="pt-2 border-t border-emerald-200/60 flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-700">Select Sheet to Import:</span>
                      <select 
                        value={selectedSheet}
                        onChange={handleSheetSelectChange}
                        className="bg-white border border-emerald-300 rounded-lg px-2.5 py-1 text-slate-700 font-semibold focus:outline-none"
                      >
                        {sheets.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* Sample Template Download */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-500 font-medium">Need a standard Excel format?</span>
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="flex items-center gap-1.5 text-xs text-primary-600 hover:text-primary-700 font-bold hover:underline"
                >
                  <Download className="w-3.5 h-3.5" /> Download Excel Template
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: COLUMN MAPPING */}
          {step === 'mapping' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-800">Map File Columns to QuickR Fields</h3>
                <p className="text-xs text-slate-500">QuickR automatically matched common headers. Review and adjust if needed.</p>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-200">
                <div className="bg-slate-100 px-4 py-2.5 text-xs font-bold text-slate-600 grid grid-cols-12 gap-4">
                  <div className="col-span-4">QuickR Field</div>
                  <div className="col-span-1 text-center">Required</div>
                  <div className="col-span-7">Your Excel Column</div>
                </div>

                {QUICKR_FIELDS.map(field => {
                  const currentMappedHeader = mapping[field.key] || '';
                  return (
                    <div key={field.key} className="px-4 py-3 grid grid-cols-12 gap-4 items-center bg-white hover:bg-slate-50/50">
                      <div className="col-span-4 font-bold text-slate-800 text-xs">
                        {field.label}
                      </div>
                      <div className="col-span-1 text-center">
                        {field.required ? (
                          <span className="text-[10px] bg-rose-100 text-rose-700 font-extrabold px-1.5 py-0.5 rounded">YES</span>
                        ) : (
                          <span className="text-[10px] bg-slate-100 text-slate-500 font-bold px-1.5 py-0.5 rounded">OPT</span>
                        )}
                      </div>
                      <div className="col-span-7">
                        <select
                          value={currentMappedHeader}
                          onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value })}
                          className={`w-full text-xs border rounded-xl px-3 py-2 font-medium focus:outline-none ${
                            field.required && !currentMappedHeader 
                              ? 'border-rose-400 bg-rose-50/30 text-rose-800' 
                              : 'border-slate-200 bg-white text-slate-700'
                          }`}
                        >
                          <option value="">[ Don't Import ]</option>
                          {headers.map(h => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-xl text-xs text-amber-800 font-medium">
                💡 <strong>Barcode Note:</strong> Existing barcodes in your file (EAN, UPC, Code 128, custom codes) will be preserved with exact leading zeroes intact. Products with missing barcodes will be assigned QuickR barcodes automatically.
              </div>
            </div>
          )}

          {/* STEP 3: VALIDATE & PREVIEW */}
          {step === 'preview' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold text-slate-800">Validation & Preview Summary</h3>
                  <p className="text-xs text-slate-500">Previewing first 100 rows of {normalizedProducts.length} total detected items</p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl text-xs font-bold text-emerald-700">
                    ✓ {validPreviewCount} Ready
                  </div>
                  {invalidPreviewCount > 0 && (
                    <div className="bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl text-xs font-bold text-rose-700">
                      ⚠ {invalidPreviewCount} Invalid
                    </div>
                  )}
                </div>
              </div>

              {/* Data Table Preview */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto max-h-80">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold sticky top-0 bg-slate-50">
                    <tr>
                      <th className="p-3 w-12 text-center">Row</th>
                      <th className="p-3">Product Name</th>
                      <th className="p-3">Category</th>
                      <th className="p-3 text-center">Selling Price</th>
                      <th className="p-3 text-center">MRP</th>
                      <th className="p-3 text-center">Stock</th>
                      <th className="p-3">Barcode</th>
                      <th className="p-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {normalizedProducts.slice(0, 100).map((p) => {
                      const isValid = Boolean(p.name);
                      return (
                        <tr key={p.excelRow} className={!isValid ? 'bg-rose-50/40' : 'hover:bg-slate-50/50'}>
                          <td className="p-3 text-center font-mono text-slate-400">{p.excelRow}</td>
                          <td className="p-3 font-bold text-slate-800">{p.name || <span className="text-rose-500 italic">[Missing Name]</span>}</td>
                          <td className="p-3 font-medium text-slate-600">{p.category}</td>
                          <td className="p-3 text-center font-bold text-slate-800">₹{p.sellingPrice || 0}</td>
                          <td className="p-3 text-center text-slate-400">{p.originalPrice ? `₹${p.originalPrice}` : '-'}</td>
                          <td className="p-3 text-center font-medium">{p.availability || 0}</td>
                          <td className="p-3 font-mono font-bold text-slate-700">
                            {p.barcode ? p.barcode : <span className="text-slate-400 font-normal italic">Auto-Generate</span>}
                          </td>
                          <td className="p-3 text-center">
                            {isValid ? (
                              <span className="bg-emerald-100 text-emerald-800 font-bold text-[10px] px-2 py-0.5 rounded">Ready</span>
                            ) : (
                              <span className="bg-rose-100 text-rose-800 font-bold text-[10px] px-2 py-0.5 rounded">Invalid</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* STEP 4: COMPLETE RESULT */}
          {step === 'complete' && importSummary && (
            <div className="space-y-6 text-left">
              <div className="bg-emerald-50 border border-emerald-200 p-6 rounded-3xl text-center space-y-2">
                <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-bold text-slate-800">{t('import.importComplete', 'Import Complete!')}</h3>
                <p className="text-xs text-slate-600 font-medium">
                  Successfully processed <strong className="text-slate-900">{importSummary.totalRows}</strong> product rows into your QuickR inventory.
                </p>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-white p-4 rounded-2xl border border-slate-200 text-center space-y-1">
                  <p className="text-xs text-slate-400 font-bold uppercase">Imported</p>
                  <p className="text-2xl font-black text-emerald-600">{importSummary.imported}</p>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-slate-200 text-center space-y-1">
                  <p className="text-xs text-slate-400 font-bold uppercase">Skipped</p>
                  <p className="text-2xl font-black text-amber-600">{importSummary.skipped}</p>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-slate-200 text-center space-y-1">
                  <p className="text-xs text-slate-400 font-bold uppercase">Duplicates</p>
                  <p className="text-2xl font-black text-rose-600">{importSummary.duplicates}</p>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-slate-200 text-center space-y-1">
                  <p className="text-xs text-slate-400 font-bold uppercase">Barcodes Generated</p>
                  <p className="text-2xl font-black text-indigo-600">{importSummary.generatedBarcodes}</p>
                </div>
              </div>

              {/* Issue Details List */}
              {importIssues.length > 0 && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      Import Issues Log ({importIssues.length})
                    </h4>
                    
                    <div className="flex items-center gap-2">
                      <div className="flex bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
                        <button
                          onClick={() => setIssueFilter('all')}
                          className={`px-2.5 py-1 rounded-md ${issueFilter === 'all' ? 'bg-white text-slate-800 shadow-2xs font-bold' : 'text-slate-500'}`}
                        >
                          All ({importIssues.length})
                        </button>
                        <button
                          onClick={() => setIssueFilter('duplicates')}
                          className={`px-2.5 py-1 rounded-md ${issueFilter === 'duplicates' ? 'bg-white text-slate-800 shadow-2xs font-bold' : 'text-slate-500'}`}
                        >
                          Duplicates
                        </button>
                      </div>

                      <button
                        onClick={handleDownloadErrorReport}
                        className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" /> Download Report
                      </button>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 max-h-56 overflow-y-auto divide-y divide-slate-100 text-xs">
                    {filteredIssues.map((issue, idx) => (
                      <div key={idx} className="p-3 flex items-start justify-between gap-4">
                        <div className="space-y-0.5">
                          <span className="font-bold text-slate-700">Row {issue.row}: {issue.productName}</span>
                          <p className="text-slate-500">{issue.issue} • <span className="text-indigo-600 font-medium">{issue.suggestedFix}</span></p>
                        </div>
                        {issue.barcode && (
                          <span className="font-mono text-[10px] font-bold bg-slate-100 px-2 py-0.5 rounded border shrink-0">
                            {issue.barcode}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Modal Footer / Navigation Actions */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between shrink-0">
          {step === 'upload' && (
            <div className="flex justify-between w-full">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!file || Boolean(fileError)}
                onClick={() => setStep('mapping')}
                className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-sm"
              >
                Next: Map Columns <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {step === 'mapping' && (
            <div className="flex justify-between w-full">
              <button
                type="button"
                onClick={() => setStep('upload')}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                type="button"
                onClick={handleProceedToPreview}
                className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-sm"
              >
                Next: Validate & Preview <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {step === 'preview' && (
            <div className="flex justify-between w-full">
              <button
                type="button"
                onClick={() => setStep('mapping')}
                disabled={isImporting}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                type="button"
                disabled={isImporting || validPreviewCount === 0}
                onClick={handleStartImport}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 text-white font-bold text-xs px-6 py-2.5 rounded-xl transition-all shadow-md"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Importing Products...
                  </>
                ) : (
                  <>
                    Import {validPreviewCount} Valid Products <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          )}

          {step === 'complete' && (
            <div className="flex justify-end w-full">
              <button
                type="button"
                onClick={onClose}
                className="bg-primary-600 hover:bg-primary-700 text-white font-bold text-xs px-6 py-2.5 rounded-xl transition-all shadow-md"
              >
                Done & View Products
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
