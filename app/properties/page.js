"use client";

import React, { useState, useEffect } from 'react';
import { 
  useProperties, 
  useBranches, 
  useCrews, 
  createProperty, 
  updateProperty, 
  deleteProperty, 
  usePropertyOptions
} from '../hooks/useSupabase';
import Link from 'next/link';

// Property Form component - you can create this as a separate component file later
const PropertyForm = ({ property, branches, crews, onSave, onCancel }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [formData, setFormData] = useState({
    name: property?.name || '',
    monthly_invoice: property?.monthly_invoice || 0,
    current_hours: property?.current_hours || 0,
    branch_id: property?.branch_id || '',
    crew_id: property?.crew_id || '',
    region: property?.region || '',
    account_manager: property?.account_manager || '',
    property_type: property?.property_type || '',
    company: property?.company || '',
    client: property?.client || ''
  });
  
  const [selectedBranchId, setSelectedBranchId] = useState(property?.branch_id || '');
  const filteredCrews = crews.filter(crew => !selectedBranchId || crew.branch_id === selectedBranchId);

  // Use the property options hook to fetch property types from Supabase
  const { propertyTypes = [], loading: loadingPropertyTypes = false } = usePropertyOptions() || {};

  const handleChange = (e) => {
    const { name, value } = e.target;
    let processedValue = value;

    // Convert numeric values
    if (name === 'monthly_invoice' || name === 'current_hours') {
      processedValue = value === '' ? 0 : parseFloat(value);
    } else if (name === 'branch_id' || name === 'crew_id') {
      processedValue = value === '' ? null : parseInt(value);
      
      // Update selected branch for crew filtering
      if (name === 'branch_id') {
        setSelectedBranchId(processedValue);
        // Clear crew if branch changes
        if (formData.branch_id !== processedValue) {
          setFormData(prev => ({ ...prev, crew_id: null }));
        }
      }
    }

    setFormData({
      ...formData,
      [name]: processedValue,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.name) {
      setError("Property name is required");
      return;
    }
    
    if (!formData.monthly_invoice) {
      setError("Monthly invoice amount is required");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      let result;
      
      if (property && property.id) {
        // Update existing property
        result = await updateProperty(property.id, formData);
      } else {
        // Create new property
        result = await createProperty(formData);
      }
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to save property');
      }
      
      onSave(result.property || formData);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Get selected branch color
  const selectedBranch = branches.find(b => b.id === formData.branch_id);
  const selectedBranchColor = selectedBranch?.color || '#4F46E5';
  
  // Function to create a lighter version of a color
  const getLightColor = (hexColor) => {
    // Convert hex to rgba with 15% opacity
    return `${hexColor}26`; // 26 is hex for 15% opacity
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-8 max-w-4xl mx-auto border border-gray-100">
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-gray-100">
        <h2 className="text-2xl font-bold text-gray-800">
          {property ? 'Edit Property' : 'Add New Property'}
        </h2>
        
        {property && formData.branch_id && (
          <div 
            className="px-4 py-1 rounded-full text-sm font-medium border shadow-sm"
            style={{ 
              backgroundColor: getLightColor(selectedBranchColor),
              borderColor: selectedBranchColor,
              color: selectedBranchColor
            }}
          >
            {branches.find(b => b.id === formData.branch_id)?.name || ''}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-6 border-l-4 border-red-500 flex items-start">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2 col-span-2">
            <label className="block text-sm font-medium text-gray-700">
              Property Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              placeholder="Enter property name"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Monthly Invoice <span className="text-red-500">*</span>
            </label>
            <div className="relative rounded-md shadow-sm">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="text-gray-500 sm:text-sm">$</span>
              </div>
              <input
                type="number"
                name="monthly_invoice"
                value={formData.monthly_invoice}
                onChange={handleChange}
                className="block w-full pl-7 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="0"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Current Hours
            </label>
            <input
              type="number"
              name="current_hours"
              value={formData.current_hours}
              onChange={handleChange}
              className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              placeholder="0"
              step="0.1"
            />
          </div>
        </div>

        {/* Branch and Crew Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Branch <span className="text-red-500">*</span>
            </label>
            <div className="relative rounded-md shadow-sm">
              <select
                name="branch_id"
                value={formData.branch_id || ''}
                onChange={handleChange}
                className="block w-full pl-10 pr-10 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm appearance-none"
                required
              >
                <option value="">Select Branch</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
              {formData.branch_id && (
                <div 
                  className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 rounded-full shadow-sm"
                  style={{ backgroundColor: selectedBranchColor }}
                />
              )}
              <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                <svg className="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Crew
            </label>
            <div className="relative rounded-md shadow-sm">
              <select
                name="crew_id"
                value={formData.crew_id || ''}
                onChange={handleChange}
                className="block w-full px-4 pr-10 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm appearance-none"
                disabled={!formData.branch_id}
              >
                <option value="">Select Crew</option>
                {filteredCrews.map((crew) => (
                  <option key={crew.id} value={crew.id}>
                    {crew.name} ({crew.crew_type})
                  </option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                <svg className="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
            {!formData.branch_id && (
              <p className="text-xs text-gray-500 mt-1">Select a branch first</p>
            )}
          </div>
        </div>

        {/* New Fields Section */}
        <div className="border-t border-gray-200 pt-6">
          <h3 className="text-lg font-medium text-gray-700 mb-4">Additional Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Region
              </label>
              <input
                type="text"
                name="region"
                value={formData.region}
                onChange={handleChange}
                className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="Enter region"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Account Manager
              </label>
              <input
                type="text"
                name="account_manager"
                value={formData.account_manager}
                onChange={handleChange}
                className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="Enter account manager"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Property Type
              </label>
              <div className="relative rounded-md shadow-sm">
                <select
                  name="property_type"
                  value={formData.property_type || ''}
                  onChange={handleChange}
                  className="block w-full px-4 pr-10 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm appearance-none"
                >
                  <option value="">Select Type</option>
                  {loadingPropertyTypes ? (
                    <option disabled>Loading property types...</option>
                  ) : (
                    (propertyTypes || []).map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))
                  )}
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                  <svg className="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Company
              </label>
              <input
                type="text"
                name="company"
                value={formData.company}
                onChange={handleChange}
                className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="Enter company"
              />
            </div>

            <div className="space-y-2 col-span-2">
              <label className="block text-sm font-medium text-gray-700">
                Client
              </label>
              <input
                type="text"
                name="client"
                value={formData.client}
                onChange={handleChange}
                className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="Enter client name"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end space-x-4 mt-8 pt-6 border-t border-gray-100">
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-3 border border-gray-300 rounded-lg shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-6 py-3 bg-blue-600 rounded-lg shadow-sm text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors flex items-center"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Saving...
              </>
            ) : property ? (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Update Property
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create Property
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

export default function PropertiesPage() {
  // State for properties - with a very large page size to load all properties
  const [page, setPage] = useState(1);
  const pageSize = 1000; // Very large page size to load all properties
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [searchText, setSearchText] = useState('');
  
  // State for property form
  const [showForm, setShowForm] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [message, setMessage] = useState({ text: '', type: '' });
  
  // Fetch data
  const { branches, loading: branchesLoading } = useBranches();
  const { crews, loading: crewsLoading } = useCrews();
  const { properties, loading: propertiesLoading, count, totalPages } = useProperties({
    page,
    pageSize,
    sortBy,
    sortOrder
  });
  
  // Client-side filtering
  const filteredProperties = searchText 
    ? properties?.filter(property => {
        const query = searchText.toLowerCase();
        return (
          (property.name && property.name.toLowerCase().includes(query)) ||
          (property.property_type && property.property_type.toLowerCase().includes(query)) ||
          (property.account_manager && property.account_manager.toLowerCase().includes(query)) ||
          (property.region && property.region.toLowerCase().includes(query)) ||
          (property.company && property.company.toLowerCase().includes(query)) ||
          (property.client && property.client.toLowerCase().includes(query))
        );
      })
    : properties;
  
  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
  };
  
  // Get branch info helper function
  const getBranchInfo = (branchId) => {
    const branch = branches?.find(b => b.id === branchId);
    return branch ? { name: branch.name, color: branch.color } : { name: 'Unknown Branch', color: '#4F46E5' };
  };
  
  // Function to create a lighter version of a color
  const getLightColor = (hexColor) => {
    return `${hexColor}26`; // 26 is hex for 15% opacity
  };
  
  // Get crew name helper function
  const getCrewName = (crewId) => {
    const crew = crews?.find(c => c.id === crewId);
    return crew ? crew.name : '';
  };
  
  // Handlers
  const handleAddProperty = () => {
    setSelectedProperty(null);
    setShowForm(true);
  };
  
  const handleEditProperty = (property) => {
    setSelectedProperty(property);
    setShowForm(true);
  };
  
  const handleDeleteProperty = async (property) => {
    if (!confirm('Are you sure you want to delete the property "' + property.name + '"?')) {
  return;
}
    
    const result = await deleteProperty(property.id);
    if (result.success) {
      setMessage({
        text: `Property "${property.name}" successfully deleted!`,
        type: 'success'
      });
      // Reload to refresh the property list
      window.location.reload();
    } else {
      setMessage({
        text: result.error || 'Failed to delete property',
        type: 'error'
      });
    }
  };
  
  const handleSaveProperty = () => {
    setMessage({
      text: `Property successfully ${selectedProperty ? 'updated' : 'created'}!`,
      type: 'success'
    });
    setShowForm(false);
    setSelectedProperty(null);
    
    // Clear the message after 3 seconds
    setTimeout(() => {
      setMessage({ text: '', type: '' });
    }, 3000);
    
    // Reload to refresh the property list
    window.location.reload();
  };
  
  const handleCancelForm = () => {
    setShowForm(false);
    setSelectedProperty(null);
  };
  
  // Function to handle sorting
  const handleSort = (column) => {
    if (sortBy === column) {
      // Toggle sort order
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      // Change sort column
      setSortBy(column);
      setSortOrder('asc');
    }
  };
  
  // Loading state
  const isLoading = branchesLoading || crewsLoading || propertiesLoading;

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 bg-blue-100 min-h-screen">
      <div className="bg-white shadow-xl rounded-xl overflow-hidden border border-gray-100">
        <div className="bg-gradient-to-r from-white to-gray-100 p-6 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-blue-600 mr-3" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
              </svg>
              <h1 className="text-2xl font-bold text-gray-800">Property Management</h1>
            </div>
            <div className="flex space-x-3">
              <Link href="/" className="px-4 py-2 border border-gray-300 bg-white text-gray-700 rounded-lg hover:bg-gray-50 shadow-sm transition-colors flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back to Calculator
              </Link>
              <button
                onClick={handleAddProperty}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm transition-colors flex items-center"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add New Property
              </button>
            </div>
          </div>

          {/* Simple Search Bar */}
          <div className="mt-6">
            <div className="relative">
              <input
                type="text"
                placeholder="Search properties..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="w-full px-4 py-3 pl-10 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              />
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              {searchText && (
                <button
                  onClick={() => setSearchText('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400 hover:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
        
        {/* Success/Error Message */}
        {message.text && (
          <div className={`p-4 mx-6 my-4 rounded-lg flex items-start ${
            message.type === 'success' 
              ? 'bg-green-50 text-green-700 border-l-4 border-green-500' 
              : 'bg-red-50 text-red-700 border-l-4 border-red-500'
          }`}>
            {message.type === 'success' ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            )}
            <span>{message.text}</span>
          </div>
        )}
        
        {/* Properties List */}
        {isLoading ? (
          <div className="p-12 text-center">
            <div className="flex items-center justify-center">
              <div className="w-8 h-8 border-t-4 border-b-4 border-blue-500 rounded-full animate-spin"></div>
              <p className="ml-3 text-lg font-medium text-gray-700">Loading properties...</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('name')}>
                    <div className="flex items-center">
                      Property Name
                      {sortBy === 'name' && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sortOrder === 'asc' ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                        </svg>
                      )}
                    </div>
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('monthly_invoice')}>
                    <div className="flex items-center">
                      Monthly Invoice
                      {sortBy === 'monthly_invoice' && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sortOrder === 'asc' ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                        </svg>
                      )}
                    </div>
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('current_hours')}>
                    <div className="flex items-center">
                      Current Hours
                      {sortBy === 'current_hours' && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sortOrder === 'asc' ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                        </svg>
                      )}
                    </div>
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Branch</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Crew</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {filteredProperties?.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="px-6 py-12 text-center text-gray-500">
                      <div className="flex flex-col items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                        </svg>
                        <p className="text-lg font-medium">No properties found</p>
                        <p className="text-sm text-gray-400 mt-1">{searchText ? "Try a different search term" : "Add a new property to get started"}</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredProperties.map((property) => {
                    const branchInfo = getBranchInfo(property.branch_id);
                    
                    return (
                      <tr key={property.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-medium text-gray-900">{property.name}</div>
                          <div className="text-xs text-gray-500 mt-1">
                            {property.region && <span className="block">Region: {property.region}</span>}
                            {property.account_manager && <span className="block">Manager: {property.account_manager}</span>}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          {formatCurrency(property.monthly_invoice)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          {property.current_hours?.toFixed(1) || "0.0"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div 
                            className="px-3 py-1 inline-flex text-sm leading-5 font-medium rounded-full border"
                            style={{ 
                              backgroundColor: getLightColor(branchInfo.color),
                              borderColor: branchInfo.color,
                              color: branchInfo.color
                            }}
                          >
                            {branchInfo.name}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {getCrewName(property.crew_id) || '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {property.property_type || '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleEditProperty(property)}
                              className="flex items-center px-2 py-1 bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100 transition-colors"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteProperty(property)}
                              className="flex items-center px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100 transition-colors"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
        
        {/* Status footer without pagination */}
        <div className="bg-gray-50 px-4 py-3 border-t border-gray-200 sm:px-6">
          <div className="flex items-center justify-between">
            <div className="sm:block">
              <p className="text-sm text-gray-700">
                {searchText ? (
                  <span>Found <span className="font-medium">{filteredProperties?.length || 0}</span> properties matching "<span className="font-medium">{searchText}</span>"</span>
                ) : (
                  <span>Showing <span className="font-medium">{properties?.length || 0}</span> properties</span>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Property Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="max-w-4xl w-full">
            <PropertyForm
              property={selectedProperty}
              branches={branches || []}
              crews={crews || []}
              onSave={handleSaveProperty}
              onCancel={handleCancelForm}
            />
          </div>
        </div>
      )}
    </div>
  );
}