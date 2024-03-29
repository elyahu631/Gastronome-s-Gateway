// utils/dataAccess.js

const mongoose = require('mongoose');
const AppError = require('./appError');

/* The `DataAccess` class is a singleton class that provides methods for interacting with a MongoDB
database, including creating, retrieving, updating, and deleting documents. */

class DataAccess {
  /**
   * Constructor that ensures only one instance of the DataAccess class is created.
   * @returns The `DataAccess.instance` is being returned.
   */
  constructor() {
    if (!DataAccess.instance) {
      DataAccess.instance = this;
    }
    return DataAccess.instance;
  }

  /**
   * Returns the mongoose model for a given model name.
   * @param modelName - The modelName parameter is a string that represents the name of the model you
   * want to retrieve from the mongoose library.
   * @returns the mongoose model with the specified modelName.
   */
  getModel(modelName) {
    return mongoose.model(modelName);
  }

  async saveDocument(document , options = {}) {
    if (!document || typeof document.save !== 'function') {
      throw new AppError('Invalid document or document does not have a save method', 400);
    }

    try {
      const savedDocument = await document.save(options);
      return savedDocument;
    } catch (error) {
      // Handle or throw the error depending on your error handling strategy
      throw new AppError('Failed to save the document', 500);
    }
  }

  async create(modelName, data) {
    const Model = this.getModel(modelName);
    const document = await Model.create(data);
    if (document.password) {
      document.password = undefined; // Ensure the password is not returned
    }
    return document;
  }

  async findById(modelName, id, populateOptions) {
    const Model = this.getModel(modelName);
    let query = Model.findById(id);
    if (populateOptions) {
      query = query.populate(populateOptions);
    }
    const document = await query;
    if (!document) {
      throw new AppError('No document found with that ID', 404);
    }
    return document;
  }

  async updateById(modelName, id, updateData) {
    const Model = this.getModel(modelName);
    const document = await Model.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true
    });
    if (!document) {
      throw new AppError('No document found with that ID', 404);
    }
    return document;
  }

  async deleteById(modelName, id) {
    const Model = this.getModel(modelName);
    const document = await Model.findByIdAndDelete(id);
    if (!document) {
      throw new AppError('No document found with that ID', 404);
    }
  }

  async findOneByConditions(modelName, conditions, projection = {}, options = {}) {
    const Model = this.getModel(modelName);
    const documents = await Model.findOne(conditions, projection, options);
    return documents;
  }

  async updateMany(modelName, filter, updateData) {
    const Model = this.getModel(modelName);
    const result = await Model.updateMany(filter, updateData);
    return result;
  }

  async aggregate(modelName, pipeline) {
    const Model = this.getModel(modelName);
    try {
      const results = await Model.aggregate(pipeline);
      return results;
    } catch (error) {
      throw new AppError('Aggregation failed', 500);
    }
  }
}

const instance = new DataAccess();
Object.freeze(instance);

module.exports = instance;
