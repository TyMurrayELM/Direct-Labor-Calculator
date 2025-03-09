"use client";

import React, { useState, useEffect } from 'react';
import { updateCrew, createCrew, useBranches } from '../hooks/useSupabase';

const CrewForm = ({ crew, onSave, onCancel }) => {
  const { branches, loading: branchesLoading } = useBranches();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    crew_type: 'Maintenance',
    region: '',
    supervisor: '',
    size: 3,
    branch_id: '',
  });

  // Initialize form if editing an existing crew
  useEffect(() => {
    if (crew) {
      setFormData({
        name: crew.name || '',
        crew_type: crew.crew_type || 'Maintenance',
        region: crew.region || '',
        supervisor: crew.supervisor || '',
        size: crew.size || 3,
        branch_id: crew.branch_id || '',
      });
    }
  }, [crew]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    let processedValue = value;

    // Convert numeric values
    if (name === 'size' || name === 'branch_id') {
      processedValue = value === '' ? '' : parseInt(value);
    }

    setFormData({
      ...formData,
      [name]: processedValue,
    });
  };

  const validateForm = () => {
    if (!formData.name) return "Crew name is required";
    if (!formData.crew_type) return "Crew type is required";
    if (!formData.branch_id) return "Branch is required";
    if (formData.size < 1) return "Crew size must be at least 1";
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validate form data
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      let result;
      
      if (crew && crew.id) {
        // Update existing crew
        result = await updateCrew(crew.id, formData);
        if (result.success) {
          onSave({ ...crew, ...formData });
        }
      } else {
        // Create new crew
        result = await createCrew(formData);
        if (result.success) {
          onSave(result.crew);
        }
      }

      if (!result.success) {
        throw new Error(result.error || 'Failed to save crew');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Get selected branch color
  const selectedBranchColor = branches.find(b => b.id === formData.branch_id)?.color || '#4F46E5';

  return (
    <div className="bg-white rounded-xl shadow-lg p-8 max-w-3xl mx-auto border border-gray-100">
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-gray-100">
        <h2 className="text-2xl font-bold text-gray-800">
          {crew && crew.id ? 'Edit Crew' : 'Add New Crew'}
        </h2>
        
        {crew && crew.id && (
          <div 
            className="px-4 py-1 rounded-full text-white text-sm font-medium shadow-sm"
            style={{ backgroundColor: selectedBranchColor }}
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Crew Name <span className="text-red-500">*</span>
            </label>
            <div className="relative rounded-md shadow-sm">
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="Enter crew name"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Crew Type <span className="text-red-500">*</span>
            </label>
            <div className="relative rounded-md shadow-sm">
              <select
                name="crew_type"
                value={formData.crew_type}
                onChange={handleChange}
                className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm appearance-none"
                required
              >
                <option value="Maintenance">Maintenance</option>
                <option value="Enhancement">Enhancement</option>
                <option value="Installation">Installation</option>
                <option value="Irrigation">Irrigation</option>
                <option value="Tree Care">Tree Care</option>
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
              Region
            </label>
            <div className="relative rounded-md shadow-sm">
              <input
                type="text"
                name="region"
                value={formData.region}
                onChange={handleChange}
                className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="Enter region"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Supervisor
            </label>
            <div className="relative rounded-md shadow-sm">
              <input
                type="text"
                name="supervisor"
                value={formData.supervisor}
                onChange={handleChange}
                className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="Enter supervisor name"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Crew Size
            </label>
            <div className="relative rounded-md shadow-sm">
              <input
                type="number"
                name="size"
                value={formData.size}
                onChange={handleChange}
                min="1"
                max="20"
                className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="Enter crew size"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Branch <span className="text-red-500">*</span>
            </label>
            <div className="relative rounded-md shadow-sm">
              <select
                name="branch_id"
                value={formData.branch_id}
                onChange={handleChange}
                className="block w-full pl-10 pr-10 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm appearance-none"
                required
                disabled={branchesLoading}
              >
                <option value="">Select Branch</option>
                {branches.map((branch) => (
                  <option 
                    key={branch.id} 
                    value={branch.id}
                  >
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
            ) : crew && crew.id ? (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Update Crew
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create Crew
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CrewForm;