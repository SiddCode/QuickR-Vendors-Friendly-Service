import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Package, Search, Plus, Edit2, Trash2, X, AlertCircle, Barcode, Printer, Sparkles, CheckCircle2 } from 'lucide-react';
import type { Product } from '../types';
import { PrintableBarcodeModal } from '../components/PrintableBarcodeModal';

export const CATEGORIES = {
  "MEN'S WEAR": ['Shirts', 'T-Shirts', 'Polos', 'Jeans', 'Trousers', 'Formal Pants', 'Casual Pants', 'Chinos', 'Cargo Pants', 'Track Pants', 'Lowers', 'Shorts', 'Blazers', 'Suits', 'Waistcoats', 'Jackets', 'Hoodies', 'Sweatshirts', 'Innerwear', 'Ethnic Wear', 'Kurtas', 'Pyjamas', 'Dhotis', 'Sherwanis'],
  "WOMEN'S WEAR": ['Sarees', 'Kurtis', 'Salwar Suits', 'Churidar', 'Leggings', 'Palazzo', 'Dresses', 'Tops', 'T-Shirts', 'Shirts', 'Jeans', 'Trousers', 'Pants', 'Skirts', 'Shorts', 'Jumpsuits', 'Shrugs', 'Blouses', 'Dupattas', 'Lehengas', 'Gowns', 'Ethnic Wear'],
  "KIDS WEAR": ['Boys Shirts', 'Boys T-Shirts', 'Boys Jeans', 'Boys Trousers', 'Boys Shorts', 'Girls Dresses', 'Girls Tops', 'Girls Skirts', 'Kids Jeans', 'Kids Ethnic Wear', 'Kids Party Wear', 'School Wear', 'Baby Wear'],
  "UNISEX / COMMON": ['T-Shirts', 'Hoodies', 'Sweatshirts', 'Jackets', 'Jeans', 'Track Pants', 'Shorts', 'Lowers', 'Accessories'],
  "Custom": []
};

export const Products = () => {
  const { products, addProduct, updateProduct, deleteProduct, bulkDeleteProducts, generateProductBarcode, shopName } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('All');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  
  // Printable & Newly Created Barcode Modal states
  const [printProduct, setPrintProduct] = useState<Product | null>(null);
  const [newlyCreatedProduct, setNewlyCreatedProduct] = useState<Product | null>(null);
  const [generatingBarcodeId, setGeneratingBarcodeId] = useState<string | null>(null);

  // Bulk selection states
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isAllShopSelected, setIsAllShopSelected] = useState<boolean>(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [bulkResultMessage, setBulkResultMessage] = useState<string | null>(null);

  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    categoryGroup: "MEN'S WEAR",
    category: 'Shirts',
    customCategory: '',
    sellingPrice: '',
    originalPrice: '',
    sizes: '',
    colors: '',
    availability: '10',
    description: '',
    gstRate: '0',
    hsnCode: '',
    priceIncludesGst: false,
    isActive: true
  });

  const allCategories = Array.from(new Set(products.map(p => p.category))).filter(Boolean);

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (p.barcode && p.barcode.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCat = filterCategory === 'All' || p.category === filterCategory;
    return matchesSearch && matchesCat;
  });

  const visibleIds = filteredProducts.map(p => p.id);
  const isAllVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.includes(id));
  const isSomeVisibleSelected = visibleIds.some(id => selectedIds.includes(id));

  // Sync indeterminate state of desktop/mobile header checkboxes
  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = isSomeVisibleSelected && !isAllVisibleSelected;
    }
  }, [isSomeVisibleSelected, isAllVisibleSelected]);

  const handleToggleSelectAllVisible = () => {
    if (isAllVisibleSelected || isAllShopSelected) {
      setSelectedIds([]);
      setIsAllShopSelected(false);
    } else {
      setSelectedIds(visibleIds);
    }
  };

  const handleSelectAllShopProducts = () => {
    const allShopIds = products.map(p => p.id);
    setSelectedIds(allShopIds);
    setIsAllShopSelected(true);
  };

  const handleToggleSelectProduct = (id: string) => {
    setIsAllShopSelected(false);
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleExecuteBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    setIsDeleting(true);
    try {
      const res = await bulkDeleteProducts(selectedIds);
      if (res.success) {
        setBulkResultMessage(res.message);
        setSelectedIds([]);
        setIsAllShopSelected(false);
        setIsConfirmModalOpen(false);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to delete products');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenModal = (product?: Product) => {
    if (product) {
      setEditingProduct(product);
      
      // Determine group for category
      let foundGroup = 'Custom';
      for (const [group, cats] of Object.entries(CATEGORIES)) {
        if ((cats as string[]).includes(product.category)) {
          foundGroup = group;
          break;
        }
      }

      setFormData({
        name: product.name,
        categoryGroup: foundGroup,
        category: foundGroup === 'Custom' ? 'Custom' : product.category,
        customCategory: foundGroup === 'Custom' ? product.category : '',
        sellingPrice: String(product.sellingPrice),
        originalPrice: product.originalPrice ? String(product.originalPrice) : '',
        sizes: product.sizes ? product.sizes.join(', ') : '',
        colors: product.colors ? product.colors.join(', ') : '',
        availability: String(product.availability || 0),
        description: product.description || '',
        gstRate: String(product.gstRate ?? 0),
        hsnCode: product.hsnCode || '',
        priceIncludesGst: !!product.priceIncludesGst,
        isActive: product.isActive
      });
    } else {
      setEditingProduct(null);
      setFormData({
        name: '',
        categoryGroup: "MEN'S WEAR",
        category: 'Shirts',
        customCategory: '',
        sellingPrice: '',
        originalPrice: '',
        sizes: 'S, M, L, XL',
        colors: 'Blue, Black',
        availability: '10',
        description: '',
        gstRate: '0',
        hsnCode: '',
        priceIncludesGst: false,
        isActive: true
      });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.sellingPrice) {
      alert('Product name and selling price are required.');
      return;
    }

    const finalCategory = formData.categoryGroup === 'Custom' || formData.category === 'Custom'
      ? (formData.customCategory.trim() || 'General')
      : formData.category;

    const payload = {
      name: formData.name.trim(),
      category: finalCategory,
      sellingPrice: parseFloat(formData.sellingPrice) || 0,
      originalPrice: formData.originalPrice ? parseFloat(formData.originalPrice) : undefined,
      sizes: formData.sizes ? formData.sizes.split(',').map(s => s.trim()).filter(Boolean) : [],
      colors: formData.colors ? formData.colors.split(',').map(c => c.trim()).filter(Boolean) : [],
      availability: parseInt(formData.availability, 10) || 0,
      description: formData.description.trim(),
      gstRate: parseFloat(formData.gstRate) || 0,
      hsnCode: formData.hsnCode.trim(),
      priceIncludesGst: formData.priceIncludesGst,
      isActive: formData.isActive
    };

    if (editingProduct) {
      await updateProduct(editingProduct.id, payload);
    } else {
      const createdProd = await addProduct(payload);
      if (createdProd) {
        setNewlyCreatedProduct(createdProd);
      }
    }

    setIsModalOpen(false);
  };

  const handleDeactivate = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this product?')) {
      await deleteProduct(id);
    }
  };

  const handleGenerateBarcode = async (prodId: string) => {
    setGeneratingBarcodeId(prodId);
    try {
      await generateProductBarcode(prodId);
    } catch (err: any) {
      alert(err.message || 'Failed to generate barcode.');
    } finally {
      setGeneratingBarcodeId(null);
    }
  };

  const totalSelectedCount = selectedIds.length;
  const totalShopProductsCount = products.length;

  return (
    <div className="flex-grow p-4 lg:p-8 space-y-6 bg-slate-50 min-h-screen">
      {bulkResultMessage && (
        <div className="max-w-7xl mx-auto bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl flex items-center justify-between text-sm font-semibold shadow-sm">
          <span>{bulkResultMessage}</span>
          <button onClick={() => setBulkResultMessage(null)} className="text-emerald-600 hover:text-emerald-800 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex justify-between items-center max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-800">Products ({products.length})</h1>
        <button 
          onClick={() => handleOpenModal()}
          className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-primary-700 transition-colors shadow-sm"
        >
          <Plus className="w-5 h-5" />
          Add Product
        </button>
      </div>

      <div className="max-w-7xl mx-auto flex flex-col md:flex-row gap-4">
        <div className="relative flex-grow">
          <Search className="w-5 h-5 text-slate-400 absolute left-3 top-2.5" />
          <input 
            type="text" 
            placeholder="Search products by name or barcode..." 
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-primary-400 bg-white"
          />
        </div>
        <select 
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="border border-slate-200 rounded-xl px-4 py-2 bg-white focus:outline-none focus:border-primary-400 min-w-[200px]"
        >
          <option value="All">All Categories</option>
          {allCategories.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      {/* Bulk Action Toolbar */}
      <div className="max-w-7xl mx-auto bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-slate-700 select-none">
            <input 
              type="checkbox" 
              ref={selectAllCheckboxRef}
              checked={isAllVisibleSelected}
              onChange={handleToggleSelectAllVisible}
              className="w-4 h-4 rounded text-primary-600 focus:ring-primary-500 border-slate-300"
            />
            Select All
          </label>

          <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
            {totalSelectedCount} selected
          </span>

          {totalSelectedCount > 0 && totalSelectedCount < totalShopProductsCount && !isAllShopSelected && (
            <button
              onClick={handleSelectAllShopProducts}
              className="text-xs text-primary-600 hover:text-primary-800 font-bold underline transition-colors"
            >
              Select all {totalShopProductsCount} products in shop
            </button>
          )}

          {isAllShopSelected && (
            <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
              All {totalShopProductsCount} shop products selected
            </span>
          )}
        </div>

        <button
          onClick={() => setIsConfirmModalOpen(true)}
          disabled={totalSelectedCount === 0}
          className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold text-xs px-3.5 py-2 rounded-xl transition-all shadow-sm disabled:cursor-not-allowed"
        >
          <Trash2 className="w-4 h-4" />
          Delete Selected ({totalSelectedCount})
        </button>
      </div>

      <div className="max-w-7xl mx-auto bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        {filteredProducts.length === 0 ? (
          <div className="p-12 flex flex-col items-center justify-center text-slate-500">
            <Package className="w-12 h-12 mb-4 text-slate-300" />
            <h3 className="text-lg font-bold text-slate-700 mb-2">No products found</h3>
            <p className="mb-6">You don't have any products matching this criteria.</p>
            <button 
              onClick={() => handleOpenModal()}
              className="bg-primary-50 text-primary-600 px-6 py-2 rounded-lg font-bold hover:bg-primary-100"
            >
              + Add Product
            </button>
          </div>
        ) : (
          <div>
            {/* Mobile Product Cards View */}
            <div className="md:hidden divide-y divide-slate-100">
              {filteredProducts.map(prod => {
                const isChecked = selectedIds.includes(prod.id);
                return (
                  <div key={prod.id} className={`p-4 space-y-3 transition-colors ${isChecked ? 'bg-primary-50/30' : ''}`}>
                    <div className="flex justify-between items-start">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleSelectProduct(prod.id)}
                          className="mt-1 w-4 h-4 rounded text-primary-600 focus:ring-primary-500 border-slate-300"
                        />
                        <div>
                          <h3 className="font-bold text-slate-800 text-sm">{prod.name}</h3>
                          <p className="text-xs text-slate-400 mt-0.5">{prod.sizes.join(', ')} • {prod.colors.join(', ')}</p>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md text-[10px] font-bold">
                        {prod.category}
                      </span>
                    </div>

                    {/* Barcode Display on Mobile */}
                    <div className="flex items-center justify-between text-xs bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <div className="flex items-center gap-1.5 font-mono text-slate-700">
                        <Barcode className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        {prod.barcode ? (
                          <span className="font-bold text-xs">{prod.barcode}</span>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">No barcode</span>
                        )}
                      </div>
                      {prod.barcode ? (
                        <button
                          onClick={() => setPrintProduct(prod)}
                          className="px-2 py-1 bg-white hover:bg-primary-50 text-primary-600 border border-slate-200 rounded font-bold text-[10px] flex items-center gap-1 shadow-2xs"
                        >
                          <Printer className="w-3 h-3" /> Print
                        </button>
                      ) : (
                        <button
                          onClick={() => handleGenerateBarcode(prod.id)}
                          disabled={generatingBarcodeId === prod.id}
                          className="px-2 py-1 bg-primary-600 hover:bg-primary-700 text-white rounded font-bold text-[10px] flex items-center gap-1 shadow-2xs disabled:opacity-50"
                        >
                          <Sparkles className="w-3 h-3" /> {generatingBarcodeId === prod.id ? 'Generating...' : 'Generate'}
                        </button>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <div>
                        <span className="font-bold text-slate-800 text-sm">₹{prod.sellingPrice}</span>
                        {prod.originalPrice ? <span className="text-[10px] text-slate-400 line-through ml-1.5">₹{prod.originalPrice}</span> : null}
                      </div>
                      {prod.availability > 0 ? (
                        <span className="text-emerald-600 font-semibold text-xs">{prod.availability} in stock</span>
                      ) : (
                        <span className="text-rose-500 font-semibold text-xs">Out of stock</span>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-50 text-xs">
                      {prod.isActive ? (
                        <span className="text-emerald-600 font-bold text-[11px] bg-emerald-50 px-2 py-0.5 rounded">Active</span>
                      ) : (
                        <span className="text-slate-400 font-bold text-[11px] bg-slate-100 px-2 py-0.5 rounded">Disabled</span>
                      )}
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => handleOpenModal(prod)}
                          className="p-1.5 text-slate-500 hover:text-primary-600 bg-slate-50 hover:bg-primary-50 rounded-lg transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleDeactivate(prod.id)}
                          className="p-1.5 text-slate-500 hover:text-rose-600 bg-slate-50 hover:bg-rose-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 text-sm">
                  <tr>
                    <th className="p-4 w-10">
                      <input
                        type="checkbox"
                        checked={isAllVisibleSelected}
                        onChange={handleToggleSelectAllVisible}
                        className="w-4 h-4 rounded text-primary-600 focus:ring-primary-500 border-slate-300"
                      />
                    </th>
                    <th className="p-4 font-semibold">Product Info</th>
                    <th className="p-4 font-semibold">Category</th>
                    <th className="p-4 font-semibold">Barcode</th>
                    <th className="p-4 font-semibold">Price</th>
                    <th className="p-4 font-semibold">Stock</th>
                    <th className="p-4 font-semibold">Status</th>
                    <th className="p-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredProducts.map(prod => {
                    const isChecked = selectedIds.includes(prod.id);
                    return (
                      <tr key={prod.id} className={`hover:bg-slate-50/50 transition-colors ${isChecked ? 'bg-primary-50/30' : ''}`}>
                        <td className="p-4 w-10">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleSelectProduct(prod.id)}
                            className="w-4 h-4 rounded text-primary-600 focus:ring-primary-500 border-slate-300"
                          />
                        </td>
                        <td className="p-4">
                          <p className="font-bold text-slate-800">{prod.name}</p>
                          <p className="text-xs text-slate-400">{prod.sizes.join(', ')} • {prod.colors.join(', ')}</p>
                        </td>
                        <td className="p-4">
                          <span className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-semibold">
                            {prod.category}
                          </span>
                        </td>
                        <td className="p-4">
                          {prod.barcode ? (
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-slate-800 bg-slate-100 px-2 py-1 rounded border border-slate-200">
                                {prod.barcode}
                              </span>
                              <button
                                onClick={() => setPrintProduct(prod)}
                                className="px-2 py-1 bg-white hover:bg-primary-50 text-primary-600 border border-slate-200 rounded-lg font-bold text-xs flex items-center gap-1 shadow-2xs transition-colors"
                                title="Print printable barcode label"
                              >
                                <Printer className="w-3.5 h-3.5" /> Print
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleGenerateBarcode(prod.id)}
                              disabled={generatingBarcodeId === prod.id}
                              className="px-2.5 py-1 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-bold text-xs flex items-center gap-1 shadow-2xs transition-all disabled:opacity-50"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              {generatingBarcodeId === prod.id ? 'Generating...' : 'Generate Barcode'}
                            </button>
                          )}
                        </td>
                        <td className="p-4">
                          <p className="font-bold text-slate-800 text-sm">₹{prod.sellingPrice}</p>
                          {prod.originalPrice && (
                            <p className="text-xs text-slate-400 line-through">₹{prod.originalPrice}</p>
                          )}
                        </td>
                        <td className="p-4 text-sm font-medium">
                          {prod.availability > 0 ? (
                            <span className="text-emerald-600 font-semibold">{prod.availability} in stock</span>
                          ) : (
                            <span className="text-rose-500 font-semibold">Out of stock</span>
                          )}
                        </td>
                        <td className="p-4">
                          {prod.isActive ? (
                            <span className="px-2.5 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-xs font-bold">
                              Active
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 bg-slate-100 text-slate-400 rounded-lg text-xs font-bold">
                              Disabled
                            </span>
                          )}
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button 
                              onClick={() => handleOpenModal(prod)}
                              className="p-2 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-xl transition-colors"
                              title="Edit product"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => handleDeactivate(prod.id)}
                              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                              title="Delete product"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Bulk Delete Confirmation Modal */}
      {isConfirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full border border-slate-100 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <AlertCircle className="w-6 h-6 shrink-0" />
              <h3 className="text-lg font-bold text-slate-800">
                Delete {totalSelectedCount} {totalSelectedCount === 1 ? 'product' : 'products'}?
              </h3>
            </div>
            <p className="text-sm text-slate-600">
              You are about to delete <strong className="text-slate-800 font-bold">{totalSelectedCount} selected {totalSelectedCount === 1 ? 'product' : 'products'}</strong>.
              {isAllShopSelected && (
                <span className="block mt-2 text-rose-600 font-bold">
                  Warning: You have selected ALL {totalShopProductsCount} products in your shop!
                </span>
              )}
            </p>
            <p className="text-xs text-slate-400 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
              Note: Products referenced by completed bills will be safely deactivated to preserve historical bill records.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setIsConfirmModalOpen(false)}
                disabled={isDeleting}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-bold text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteBulkDelete}
                disabled={isDeleting}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-xs transition-colors shadow-sm disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : `Delete ${totalSelectedCount} Products`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Product Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto border border-slate-100 shadow-2xl">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <h2 className="text-lg font-bold text-slate-800">
                {editingProduct ? 'Edit Product' : 'Add New Product'}
              </h2>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Product Name *</label>
                <input 
                  type="text" 
                  required
                  placeholder="e.g. Cotton Formal Shirt"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-primary-400 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Category Group</label>
                  <select 
                    value={formData.categoryGroup}
                    onChange={e => {
                      const group = e.target.value;
                      const defaultCat = CATEGORIES[group as keyof typeof CATEGORIES]?.[0] || 'Custom';
                      setFormData({ ...formData, categoryGroup: group, category: defaultCat });
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-primary-400 text-sm bg-white"
                  >
                    {Object.keys(CATEGORIES).map(group => (
                      <option key={group} value={group}>{group}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Category</label>
                  {formData.categoryGroup === 'Custom' ? (
                    <input 
                      type="text" 
                      placeholder="Enter custom category"
                      value={formData.customCategory}
                      onChange={e => setFormData({ ...formData, customCategory: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-primary-400 text-sm"
                    />
                  ) : (
                    <select 
                      value={formData.category}
                      onChange={e => setFormData({ ...formData, category: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-primary-400 text-sm bg-white"
                    >
                      {(CATEGORIES[formData.categoryGroup as keyof typeof CATEGORIES] || []).map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                      <option value="Custom">+ Custom Category</option>
                    </select>
                  )}
                </div>
              </div>

              {formData.category === 'Custom' && formData.categoryGroup !== 'Custom' && (
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Custom Category Name</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Winter Accessories"
                    value={formData.customCategory}
                    onChange={e => setFormData({ ...formData, customCategory: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-primary-400 text-sm"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Selling Price (₹) *</label>
                  <input 
                    type="number" 
                    required
                    min="0"
                    placeholder="999"
                    value={formData.sellingPrice}
                    onChange={e => setFormData({ ...formData, sellingPrice: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-primary-400 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">MRP / Original Price (₹)</label>
                  <input 
                    type="number" 
                    min="0"
                    placeholder="1299"
                    value={formData.originalPrice}
                    onChange={e => setFormData({ ...formData, originalPrice: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-primary-400 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Available Stock (Qty)</label>
                  <input 
                    type="number" 
                    min="0"
                    value={formData.availability}
                    onChange={e => setFormData({ ...formData, availability: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-primary-400 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">GST Rate (%)</label>
                  <select
                    value={formData.gstRate}
                    onChange={e => setFormData({ ...formData, gstRate: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-primary-400 text-sm bg-white"
                  >
                    <option value="0">0% (Exempt)</option>
                    <option value="5">5% (Apparel/Footwear)</option>
                    <option value="12">12% (Apparel &gt; ₹1000)</option>
                    <option value="18">18% (Standard)</option>
                    <option value="28">28% (Luxury)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Sizes (Comma separated)</label>
                  <input 
                    type="text" 
                    placeholder="S, M, L, XL"
                    value={formData.sizes}
                    onChange={e => setFormData({ ...formData, sizes: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-primary-400 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Colors (Comma separated)</label>
                  <input 
                    type="text" 
                    placeholder="Blue, Navy, Black"
                    value={formData.colors}
                    onChange={e => setFormData({ ...formData, colors: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-primary-400 text-sm"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input 
                  type="checkbox"
                  id="priceIncludesGst"
                  checked={formData.priceIncludesGst}
                  onChange={e => setFormData({ ...formData, priceIncludesGst: e.target.checked })}
                  className="rounded text-primary-600 focus:ring-primary-400"
                />
                <label htmlFor="priceIncludesGst" className="text-xs text-slate-700 font-medium">
                  Selling price already includes GST
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-semibold"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-bold shadow-sm"
                >
                  {editingProduct ? 'Update Product' : 'Save Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Newly Created Product Barcode Popup Modal */}
      {newlyCreatedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn font-sans">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full border border-slate-100 shadow-2xl text-center space-y-4">
            <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-slate-800">Product Created Successfully!</h3>
              <p className="text-xs text-slate-500 mt-1 font-medium">{newlyCreatedProduct.name}</p>
            </div>

            {newlyCreatedProduct.barcode ? (
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2">
                <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Generated Barcode</p>
                <div className="font-mono text-lg font-black text-slate-900 tracking-wider">
                  {newlyCreatedProduct.barcode}
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-2 pt-2">
              {newlyCreatedProduct.barcode && (
                <button
                  onClick={() => {
                    const prodToPrint = newlyCreatedProduct;
                    setNewlyCreatedProduct(null);
                    setPrintProduct(prodToPrint);
                  }}
                  className="w-full bg-primary-600 hover:bg-primary-700 text-white py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-md transition-all"
                >
                  <Printer className="w-4 h-4" /> Print Barcode Label (A4 2×2)
                </button>
              )}

              <button
                onClick={() => setNewlyCreatedProduct(null)}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 py-2.5 rounded-xl font-bold text-xs transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Printable Barcode Label Modal */}
      {printProduct && (
        <PrintableBarcodeModal
          product={printProduct}
          shopName={shopName}
          onClose={() => setPrintProduct(null)}
        />
      )}
    </div>
  );
};
